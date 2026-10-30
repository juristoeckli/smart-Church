import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import type { ModuleServerContext } from "../module-sdk.js";
import { registerPeopleFlowsReplication } from "./replication.js";

type FlowRow = { id: string; name: string; description: string; status: "active" | "archived"; created_at: Date | string; updated_at: Date | string; step_count: number; enrollment_count: number };
type StepRow = { id: string; title: string; instructions: string; position: number; due_after_days: number | null; required: boolean; active: boolean };
const idSchema = { type: "string", format: "uuid" } as const;

function mapFlow(row: FlowRow) {
  return { id: row.id, name: row.name, description: row.description, status: row.status, stepCount: Number(row.step_count), activeEnrollmentCount: Number(row.enrollment_count), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
}

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation, realtime } = context;
  registerPeopleFlowsReplication(context);
  app.register(async (routes) => {
    async function department(request: FastifyRequest, reply: FastifyReply, write = false) {
      if (!isDatabaseReady() || !pool) {
        reply.code(503).send({ error: "People Flows are unavailable because the database is not ready." });
        return null;
      }
      return resolveDepartmentId(request, reply, false, false, write ? "people_manage" : "people_view_private");
    }
    async function audit(departmentId: string, actorId: string | undefined, action: string, values: { flowId?: string; enrollmentId?: string; stepId?: string; metadata?: Record<string, unknown> }) {
      await pool!.query(
        "INSERT INTO people_flow_audit(id,department_id,actor_user_id,action,flow_id,enrollment_id,step_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
        [randomUUID(), departmentId, actorId ?? null, action, values.flowId ?? null, values.enrollmentId ?? null, values.stepId ?? null, JSON.stringify(values.metadata ?? {})],
      );
    }
    function publish(departmentId: string, action: string, flowId: string) {
      realtime.publish("people-flows:changed", departmentId, { action, flowId });
    }

    routes.get("/api/people-flows", async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const result = await pool!.query<FlowRow>(
        `SELECT f.id,f.name,f.description,f.status,f.created_at,f.updated_at,
                (SELECT count(*)::int FROM people_flow_steps s WHERE s.department_id=f.department_id AND s.flow_id=f.id AND s.active=TRUE) AS step_count,
                (SELECT count(*)::int FROM people_flow_enrollments e WHERE e.department_id=f.department_id AND e.flow_id=f.id AND e.status='active') AS enrollment_count
           FROM people_flows f WHERE f.department_id=$1 ORDER BY f.status,f.name,f.created_at`,
        [departmentId],
      );
      return result.rows.map(mapFlow);
    });

    routes.get<{ Params: { id: string } }>("/api/people-flows/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: idSchema } } } }, async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const flow = await pool!.query<FlowRow>(
        `SELECT f.id,f.name,f.description,f.status,f.created_at,f.updated_at,
                (SELECT count(*)::int FROM people_flow_steps s WHERE s.department_id=f.department_id AND s.flow_id=f.id AND s.active=TRUE) AS step_count,
                (SELECT count(*)::int FROM people_flow_enrollments e WHERE e.department_id=f.department_id AND e.flow_id=f.id AND e.status='active') AS enrollment_count
           FROM people_flows f WHERE f.department_id=$1 AND f.id=$2`,
        [departmentId, request.params.id],
      );
      if (!flow.rowCount) return reply.code(404).send({ error: "People Flow not found." });
      const steps = await pool!.query<StepRow>(
        "SELECT id,title,instructions,position,due_after_days,required,active FROM people_flow_steps WHERE department_id=$1 AND flow_id=$2 ORDER BY position,id",
        [departmentId, request.params.id],
      );
      return { ...mapFlow(flow.rows[0]), steps: steps.rows.map((step) => ({ id: step.id, title: step.title, instructions: step.instructions, position: step.position, dueAfterDays: step.due_after_days, required: step.required, active: step.active })) };
    });

    routes.post<{ Body: { name: string; description?: string } }>("/api/people-flows", { schema: {
      body: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 120 }, description: { type: "string", maxLength: 2000 } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId) return reply;
      if (!validateMutation(request, reply)) return reply;
      const name = request.body.name.trim();
      if (!name) return reply.code(400).send({ error: "Enter a workflow name." });
      const id = randomUUID();
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query("INSERT INTO people_flows(id,department_id,name,description,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,name,description,status,created_at,updated_at", [id, departmentId, name, request.body.description?.trim() ?? "", request.authenticatedUser?.id ?? null]);
        await client.query("INSERT INTO people_flow_audit(id,department_id,actor_user_id,action,flow_id,metadata) VALUES($1,$2,$3,'flow_created',$4,$5::jsonb)", [randomUUID(), departmentId, request.authenticatedUser?.id ?? null, id, JSON.stringify({ name })]);
        await client.query("COMMIT");
        publish(departmentId, "flow_created", id);
        return reply.code(201).send({ ...result.rows[0], stepCount: 0, activeEnrollmentCount: 0 });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    });

    routes.put<{ Params: { id: string }; Body: { name: string; description?: string } }>("/api/people-flows/:id", { schema: {
      params: { type: "object", required: ["id"], properties: { id: idSchema } },
      body: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 120 }, description: { type: "string", maxLength: 2000 } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId) return reply;
      if (!validateMutation(request, reply)) return reply;
      const name = request.body.name.trim();
      if (!name) return reply.code(400).send({ error: "Enter a workflow name." });
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query("UPDATE people_flows SET name=$3,description=$4,updated_at=now() WHERE department_id=$1 AND id=$2 RETURNING id", [departmentId, request.params.id, name, request.body.description?.trim() ?? ""]);
        if (!result.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "People Flow not found." }); }
        await client.query("INSERT INTO people_flow_audit(id,department_id,actor_user_id,action,flow_id,metadata) VALUES($1,$2,$3,'flow_updated',$4,$5::jsonb)", [randomUUID(), departmentId, request.authenticatedUser?.id ?? null, request.params.id, JSON.stringify({ name })]);
        await client.query("COMMIT");
        publish(departmentId, "flow_updated", request.params.id);
        return { updated: true };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    });

    routes.put<{ Params: { id: string }; Body: { status: "active" | "archived" } }>("/api/people-flows/:id/status", { schema: {
      params: { type: "object", required: ["id"], properties: { id: idSchema } },
      body: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", enum: ["active", "archived"] } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId) return reply;
      if (!validateMutation(request, reply)) return reply;
      const result = await pool!.query("UPDATE people_flows SET status=$3,updated_at=now() WHERE department_id=$1 AND id=$2 RETURNING id", [departmentId, request.params.id, request.body.status]);
      if (!result.rowCount) return reply.code(404).send({ error: "People Flow not found." });
      await audit(departmentId, request.authenticatedUser?.id, request.body.status === "archived" ? "flow_archived" : "flow_activated", { flowId: request.params.id });
      publish(departmentId, "flow_status_changed", request.params.id);
      return { updated: true };
    });

    routes.post<{ Params: { id: string }; Body: { title: string; instructions?: string; dueAfterDays?: number | null; required?: boolean } }>("/api/people-flows/:id/steps", { schema: {
      params: { type: "object", required: ["id"], properties: { id: idSchema } },
      body: { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string", minLength: 1, maxLength: 160 }, instructions: { type: "string", maxLength: 4000 }, dueAfterDays: { anyOf: [{ type: "integer", minimum: 0, maximum: 3650 }, { type: "null" }] }, required: { type: "boolean" } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId) return reply;
      if (!validateMutation(request, reply)) return reply;
      const title = request.body.title.trim();
      if (!title) return reply.code(400).send({ error: "Enter a step title." });
      const id = randomUUID();
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const flow = await client.query("SELECT status FROM people_flows WHERE id=$1 AND department_id=$2 FOR UPDATE", [request.params.id, departmentId]);
        if (!flow.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "People Flow not found." }); }
        const position = await client.query<{ next: number }>("SELECT COALESCE(max(position)+1,0)::int AS next FROM people_flow_steps WHERE department_id=$1 AND flow_id=$2", [departmentId, request.params.id]);
        const row = await client.query("INSERT INTO people_flow_steps(id,department_id,flow_id,title,instructions,position,due_after_days,required,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,title,instructions,position,due_after_days,required,active", [id, departmentId, request.params.id, title, request.body.instructions?.trim() ?? "", position.rows[0].next, request.body.dueAfterDays ?? null, request.body.required ?? true, request.authenticatedUser?.id ?? null]);
        await client.query("INSERT INTO people_flow_audit(id,department_id,actor_user_id,action,flow_id,step_id,metadata) VALUES($1,$2,$3,'step_created',$4,$5,$6::jsonb)", [randomUUID(), departmentId, request.authenticatedUser?.id ?? null, request.params.id, id, JSON.stringify({ position: position.rows[0].next })]);
        await client.query("COMMIT");
        publish(departmentId, "step_created", request.params.id);
        const step = row.rows[0];
        return reply.code(201).send({ id: step.id, title: step.title, instructions: step.instructions, position: step.position, dueAfterDays: step.due_after_days, required: step.required, active: step.active });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    });

    routes.put<{ Params: { id: string }; Body: { title: string; instructions?: string; dueAfterDays?: number | null; required?: boolean; active?: boolean } }>("/api/people-flow-steps/:id", { schema: {
      params: { type: "object", required: ["id"], properties: { id: idSchema } },
      body: { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string", minLength: 1, maxLength: 160 }, instructions: { type: "string", maxLength: 4000 }, dueAfterDays: { anyOf: [{ type: "integer", minimum: 0, maximum: 3650 }, { type: "null" }] }, required: { type: "boolean" }, active: { type: "boolean" } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId) return reply;
      if (!validateMutation(request, reply)) return reply;
      const title = request.body.title.trim();
      if (!title) return reply.code(400).send({ error: "Enter a step title." });
      const result = await pool!.query<{ flow_id: string }>("UPDATE people_flow_steps SET title=$3,instructions=$4,due_after_days=$5,required=$6,active=$7,updated_at=now() WHERE department_id=$1 AND id=$2 RETURNING flow_id", [departmentId, request.params.id, title, request.body.instructions?.trim() ?? "", request.body.dueAfterDays ?? null, request.body.required ?? true, request.body.active ?? true]);
      if (!result.rowCount) return reply.code(404).send({ error: "Workflow step not found." });
      await audit(departmentId, request.authenticatedUser?.id, "step_updated", { flowId: result.rows[0].flow_id, stepId: request.params.id });
      publish(departmentId, "step_updated", result.rows[0].flow_id);
      return { updated: true };
    });

    routes.get<{ Params: { id: string } }>("/api/people-flows/:id/assignments", { schema: { params: { type: "object", required: ["id"], properties: { id: idSchema } } }, async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const result = await pool!.query(
        `SELECT e.id,e.flow_id,e.contact_id,e.status,e.due_on,e.started_at,e.completed_at,c.first_name,c.last_name,
                COALESCE(json_agg(json_build_object('stepId',s.id,'title',s.title,'position',s.position,'required',s.required,'active',s.active,'status',p.status,'dueOn',p.due_on,'completedAt',p.completed_at) ORDER BY s.position,s.id) FILTER (WHERE s.id IS NOT NULL),'[]'::json) AS steps
           FROM people_flow_enrollments e
           JOIN contacts c ON c.id=e.contact_id AND c.department_id=e.department_id
           LEFT JOIN people_flow_step_progress p ON p.department_id=e.department_id AND p.enrollment_id=e.id
           LEFT JOIN people_flow_steps s ON s.department_id=p.department_id AND s.id=p.step_id
          WHERE e.department_id=$1 AND e.flow_id=$2
          GROUP BY e.id,c.first_name,c.last_name ORDER BY e.status,e.due_on NULLS LAST,lower(c.last_name),lower(c.first_name)`,
        [departmentId, request.params.id],
      );
      return result.rows.map((row) => ({ id: row.id, flowId: row.flow_id, contactId: row.contact_id, contactName: `${row.first_name} ${row.last_name}`, status: row.status, dueOn: row.due_on ? String(row.due_on).slice(0, 10) : null, startedAt: new Date(row.started_at).toISOString(), completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null, steps: row.steps }));
    });

    routes.post<{ Params: { id: string }; Body: { contactIds: string[]; dueOn?: string | null } }>("/api/people-flows/:id/assignments", { schema: {
      params: { type: "object", required: ["id"], properties: { id: idSchema } },
      body: { type: "object", additionalProperties: false, required: ["contactIds"], properties: { contactIds: { type: "array", minItems: 1, maxItems: 200, uniqueItems: true, items: idSchema }, dueOn: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId) return reply;
      if (!validateMutation(request, reply)) return reply;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const flow = await client.query("SELECT status FROM people_flows WHERE id=$1 AND department_id=$2 FOR UPDATE", [request.params.id, departmentId]);
        if (!flow.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "People Flow not found." }); }
        if (flow.rows[0].status !== "active") { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Activate this workflow before assigning people." }); }
        const contacts = await client.query("SELECT id FROM contacts WHERE department_id=$1 AND id=ANY($2::uuid[])", [departmentId, request.body.contactIds]);
        if (contacts.rowCount !== request.body.contactIds.length) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Every selected person must belong to this location." }); }
        const stepRows = await client.query<{ id: string; due_after_days: number | null }>("SELECT id,due_after_days FROM people_flow_steps WHERE department_id=$1 AND flow_id=$2 AND active=TRUE ORDER BY position,id", [departmentId, request.params.id]);
        const created: string[] = [];
        for (const contactId of request.body.contactIds) {
          const enrollmentId = randomUUID();
          const enrollment = await client.query("INSERT INTO people_flow_enrollments(id,department_id,flow_id,contact_id,due_on,created_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (department_id,flow_id,contact_id) WHERE status='active' DO NOTHING RETURNING id", [enrollmentId, departmentId, request.params.id, contactId, request.body.dueOn ?? null, request.authenticatedUser?.id ?? null]);
          if (!enrollment.rowCount) continue;
          created.push(enrollmentId);
          for (const step of stepRows.rows) {
            const progressId = randomUUID();
            await client.query("INSERT INTO people_flow_step_progress(id,department_id,enrollment_id,step_id,due_on) VALUES($1,$2,$3,$4,CASE WHEN $5::int IS NULL THEN NULL ELSE current_date+$5::int END)", [progressId, departmentId, enrollmentId, step.id, step.due_after_days]);
          }
        }
        await client.query("INSERT INTO people_flow_audit(id,department_id,actor_user_id,action,flow_id,metadata) VALUES($1,$2,$3,'people_assigned',$4,$5::jsonb)", [randomUUID(), departmentId, request.authenticatedUser?.id ?? null, request.params.id, JSON.stringify({ requested: request.body.contactIds.length, created: created.length })]);
        await client.query("COMMIT");
        publish(departmentId, "people_assigned", request.params.id);
        return reply.code(201).send({ created: created.length, skipped: request.body.contactIds.length - created.length, enrollmentIds: created });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    });

    routes.put<{ Params: { id: string }; Body: { status: "active" | "completed" | "cancelled" } }>("/api/people-flow-assignments/:id/status", { schema: {
      params: { type: "object", required: ["id"], properties: { id: idSchema } },
      body: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", enum: ["active", "completed", "cancelled"] } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId) return reply;
      if (!validateMutation(request, reply)) return reply;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const enrollment = await client.query<{ id: string; flow_id: string; status: string; contact_id: string }>("SELECT id,flow_id,status,contact_id FROM people_flow_enrollments WHERE department_id=$1 AND id=$2 FOR UPDATE", [departmentId, request.params.id]);
        if (!enrollment.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Workflow assignment not found." }); }
        if (request.body.status === "active" && enrollment.rows[0].status !== "active") {
          const existingActive = await client.query("SELECT 1 FROM people_flow_enrollments WHERE department_id=$1 AND flow_id=$2 AND contact_id=$3 AND status='active' AND id<>$4 LIMIT 1", [departmentId, enrollment.rows[0].flow_id, enrollment.rows[0].contact_id, request.params.id]);
          if (existingActive.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "This person already has an active assignment for the workflow." }); }
        }
        if (request.body.status === "completed") {
          const incomplete = await client.query("SELECT 1 FROM people_flow_step_progress p JOIN people_flow_steps s ON s.id=p.step_id AND s.department_id=p.department_id WHERE p.department_id=$1 AND p.enrollment_id=$2 AND s.active=TRUE AND s.required=TRUE AND p.status<>'completed' LIMIT 1", [departmentId, request.params.id]);
          if (incomplete.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Complete all required steps before completing this workflow assignment." }); }
        }
        await client.query("UPDATE people_flow_enrollments SET status=$3,completed_at=CASE WHEN $3='completed' THEN now() ELSE NULL END,updated_at=now() WHERE department_id=$1 AND id=$2", [departmentId, request.params.id, request.body.status]);
        await client.query("INSERT INTO people_flow_audit(id,department_id,actor_user_id,action,flow_id,enrollment_id) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), departmentId, request.authenticatedUser?.id ?? null, `assignment_${request.body.status}`, enrollment.rows[0].flow_id, request.params.id]);
        await client.query("COMMIT");
        publish(departmentId, "assignment_status_changed", enrollment.rows[0].flow_id);
        return { updated: true };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    });

    routes.put<{ Params: { id: string; stepId: string }; Body: { status: "pending" | "completed" | "skipped" } }>("/api/people-flow-assignments/:id/steps/:stepId", { schema: {
      params: { type: "object", required: ["id","stepId"], properties: { id: idSchema, stepId: idSchema } },
      body: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", enum: ["pending","completed","skipped"] } } },
    } }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId) return reply;
      if (!validateMutation(request, reply)) return reply;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const assignment = await client.query<{ flow_id: string; status: string }>("SELECT flow_id,status FROM people_flow_enrollments WHERE department_id=$1 AND id=$2 FOR UPDATE", [departmentId, request.params.id]);
        if (!assignment.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Workflow assignment not found." }); }
        if (assignment.rows[0].status !== "active") { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Reopen this workflow assignment before changing its steps." }); }
        const changed = await client.query("UPDATE people_flow_step_progress p SET status=$4,completed_at=CASE WHEN $4='completed' THEN now() ELSE NULL END,updated_by=$3,updated_at=now() FROM people_flow_steps s WHERE p.department_id=$1 AND p.enrollment_id=$2 AND p.step_id=$5 AND s.id=p.step_id AND s.department_id=p.department_id AND s.flow_id=$6 RETURNING p.id", [departmentId, request.params.id, request.authenticatedUser?.id ?? null, request.body.status, request.params.stepId, assignment.rows[0].flow_id]);
        if (!changed.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Workflow step progress not found." }); }
        await client.query("INSERT INTO people_flow_audit(id,department_id,actor_user_id,action,flow_id,enrollment_id,step_id,metadata) VALUES($1,$2,$3,'step_status_changed',$4,$5,$6,$7::jsonb)", [randomUUID(), departmentId, request.authenticatedUser?.id ?? null, assignment.rows[0].flow_id, request.params.id, request.params.stepId, JSON.stringify({ status: request.body.status })]);
        await client.query("COMMIT");
        publish(departmentId, "step_status_changed", assignment.rows[0].flow_id);
        return { updated: true };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    });

    routes.get("/api/people-flows/audit", async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const result = await pool!.query("SELECT id,actor_user_id,action,flow_id,enrollment_id,step_id,metadata,created_at FROM people_flow_audit WHERE department_id=$1 ORDER BY created_at DESC LIMIT 100", [departmentId]);
      return result.rows.map((row) => ({ id: row.id, actorUserId: row.actor_user_id, action: row.action, flowId: row.flow_id, enrollmentId: row.enrollment_id, stepId: row.step_id, metadata: row.metadata, createdAt: new Date(row.created_at).toISOString() }));
    });
  });
}
