import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import type { ModuleServerContext } from "../module-sdk.js";

type JsonObject = Record<string, unknown>;
type FlowLinkBody = { sourceFlowId: string; localFlowId: string | null; stepLinks: Array<{ sourceStepId: string; localStepId: string }> };

function rows(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  if (value && typeof value === "object") return Object.values(value).filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  return [];
}
function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}
function remoteSteps(definition: unknown) {
  const value = definition && typeof definition === "object" ? definition as JsonObject : {};
  return rows(value.steps).map((step) => ({ id: stringValue(step.id), name: stringValue(step.name) })).filter((step) => step.id);
}
function memberPersonIds(members: unknown) {
  return new Set(rows(members).map((member) => stringValue(member.personId)).filter(Boolean));
}

export function registerElvantoPeopleFlowCrosswalkRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation } = context;
  app.register(async (routes) => {
    async function department(request: FastifyRequest, reply: FastifyReply, write = false) {
      if (!isDatabaseReady() || !pool) {
        reply.code(503).send({ error: "People Flow linking is unavailable because the database is not ready." });
        return null;
      }
      if (!write) {
        const permissions = request.activeDepartmentPermissions ?? [];
        if (request.activeDepartmentRole !== "site_admin" && !permissions.includes("people_view_private") && !permissions.includes("people_manage")) {
          reply.code(403).send({ error: "You need private People access to view workflow links." });
          return null;
        }
      }
      return resolveDepartmentId(request, reply, false, false, write ? "people_manage" : undefined);
    }

    routes.get("/api/people-flows/elvanto-crosswalk", async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const [snapshots, local, flowLinks, stepLinks, linkedPeople] = await Promise.all([
        pool!.query<{ source_id: string; name: string; definition: JsonObject; members: JsonObject[]; imported_at: Date | string }>(
          "SELECT source_id,name,definition,members,imported_at FROM elvanto_people_flows_import WHERE department_id=$1 ORDER BY lower(name),source_id LIMIT 500",
          [departmentId],
        ),
        pool!.query<{ id: string; name: string; status: string; steps: Array<{ id: string; title: string; position: number; active: boolean }> }>(
          `SELECT f.id,f.name,f.status,
                  COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'position',s.position,'active',s.active) ORDER BY s.position,s.id)
                    FILTER (WHERE s.id IS NOT NULL),'[]'::jsonb) AS steps
             FROM people_flows f
             LEFT JOIN people_flow_steps s ON s.department_id=f.department_id AND s.flow_id=f.id
            WHERE f.department_id=$1
            GROUP BY f.id ORDER BY lower(f.name),f.id`,
          [departmentId],
        ),
        pool!.query<{ source_flow_id: string; local_flow_id: string; local_name: string; local_status: string }>(
          `SELECT link.source_flow_id,link.local_flow_id,flow.name AS local_name,flow.status AS local_status
             FROM elvanto_people_flow_links link
             JOIN people_flows flow ON flow.department_id=link.department_id AND flow.id=link.local_flow_id
            WHERE link.department_id=$1`,
          [departmentId],
        ),
        pool!.query<{ source_flow_id: string; source_step_id: string; local_step_id: string; local_title: string }>(
          `SELECT link.source_flow_id,link.source_step_id,link.local_step_id,step.title AS local_title
             FROM elvanto_people_flow_step_links link
             JOIN people_flow_steps step ON step.department_id=link.department_id AND step.id=link.local_step_id
            WHERE link.department_id=$1`,
          [departmentId],
        ),
        pool!.query<{ source_id: string }>(
          "SELECT source_id FROM contacts WHERE department_id=$1 AND source_system='elvanto' AND source_id IS NOT NULL UNION SELECT elvanto_source_id AS source_id FROM contacts WHERE department_id=$1 AND elvanto_source_id IS NOT NULL",
          [departmentId],
        ),
      ]);
      const flowBySource = new Map(flowLinks.rows.map((link) => [link.source_flow_id, link]));
      const stepsBySource = new Map<string, typeof stepLinks.rows>();
      for (const link of stepLinks.rows) stepsBySource.set(link.source_flow_id, [...(stepsBySource.get(link.source_flow_id) ?? []), link]);
      const linkedPersonIds = new Set(linkedPeople.rows.map((row) => row.source_id));
      const seenSourceIds = new Set<string>();
      const flows = snapshots.rows.map((snapshot) => {
        seenSourceIds.add(snapshot.source_id);
        const link = flowBySource.get(snapshot.source_id);
        const personIds = memberPersonIds(snapshot.members);
        const mappedSteps = stepsBySource.get(snapshot.source_id) ?? [];
        const remote = remoteSteps(snapshot.definition);
        const remoteStepIds = new Set(remote.map((step) => step.id));
        return {
          sourceFlowId: snapshot.source_id,
          name: snapshot.name,
          snapshotUpdatedAt: new Date(snapshot.imported_at).toISOString(),
          sourceMissing: false,
          remoteSteps: remote,
          localFlowId: link?.local_flow_id ?? null,
          localFlowName: link?.local_name ?? null,
          localFlowStatus: link?.local_status ?? null,
          stepLinks: mappedSteps.map((step) => ({ sourceStepId: step.source_step_id, sourceStepPresent: remoteStepIds.has(step.source_step_id), localStepId: step.local_step_id, localStepTitle: step.local_title })),
          assignmentCount: personIds.size,
          linkedAssignmentCount: [...personIds].filter((id) => linkedPersonIds.has(id)).length,
          unmatchedAssignmentCount: [...personIds].filter((id) => !linkedPersonIds.has(id)).length,
        };
      });
      for (const link of flowLinks.rows) if (!seenSourceIds.has(link.source_flow_id)) {
        flows.push({
          sourceFlowId: link.source_flow_id, name: link.local_name, snapshotUpdatedAt: null, sourceMissing: true,
          remoteSteps: [], localFlowId: link.local_flow_id, localFlowName: link.local_name, localFlowStatus: link.local_status,
          stepLinks: (stepsBySource.get(link.source_flow_id) ?? []).map((step) => ({ sourceStepId: step.source_step_id, sourceStepPresent: false, localStepId: step.local_step_id, localStepTitle: step.local_title })),
          assignmentCount: 0, linkedAssignmentCount: 0, unmatchedAssignmentCount: 0,
        });
      }
      return {
        flows,
        localFlows: local.rows.map((flow) => ({ id: flow.id, name: flow.name, status: flow.status, steps: flow.steps })),
      };
    });

    routes.put<{ Body: FlowLinkBody }>("/api/people-flows/elvanto-crosswalk", {
      schema: {
        body: {
          type: "object", additionalProperties: false, required: ["sourceFlowId", "localFlowId", "stepLinks"],
          properties: {
            sourceFlowId: { type: "string", minLength: 1, maxLength: 160 },
            localFlowId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
            stepLinks: {
              type: "array", maxItems: 200, items: {
                type: "object", additionalProperties: false, required: ["sourceStepId", "localStepId"],
                properties: { sourceStepId: { type: "string", minLength: 1, maxLength: 160 }, localStepId: { type: "string", format: "uuid" } },
              },
            },
          },
        },
      },
    }, async (request, reply) => {
      const departmentId = await department(request, reply, true);
      if (!departmentId) return reply;
      if (!validateMutation(request, reply)) return reply;
      const { sourceFlowId, localFlowId, stepLinks } = request.body;
      if (new Set(stepLinks.map((link) => link.sourceStepId)).size !== stepLinks.length || new Set(stepLinks.map((link) => link.localStepId)).size !== stepLinks.length) {
        return reply.code(400).send({ error: "Each Elvanto and local step can be linked only once." });
      }
      const source = await pool!.query<{ definition: JsonObject }>(
        "SELECT definition FROM elvanto_people_flows_import WHERE department_id=$1 AND source_id=$2",
        [departmentId, sourceFlowId],
      );
      if (!source.rowCount) return reply.code(404).send({ error: "Import this Elvanto People Flow before linking it." });
      const sourceStepIds = new Set(remoteSteps(source.rows[0].definition).map((step) => step.id));
      if (stepLinks.some((link) => !sourceStepIds.has(link.sourceStepId))) return reply.code(409).send({ error: "An Elvanto step changed or disappeared. Refresh the imported People Flow before saving links." });
      if (localFlowId) {
        const local = await pool!.query<{ id: string }>("SELECT id FROM people_flows WHERE department_id=$1 AND id=$2", [departmentId, localFlowId]);
        if (!local.rowCount) return reply.code(404).send({ error: "The selected local workflow was not found." });
        const localStepIds = await pool!.query<{ id: string }>(
          "SELECT id FROM people_flow_steps WHERE department_id=$1 AND flow_id=$2 AND id=ANY($3::uuid[])",
          [departmentId, localFlowId, stepLinks.map((link) => link.localStepId)],
        );
        if (localStepIds.rowCount !== stepLinks.length) return reply.code(400).send({ error: "Every linked local step must belong to the selected workflow." });
      } else if (stepLinks.length) {
        return reply.code(400).send({ error: "Choose a local workflow before linking its steps." });
      }

      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        if (!localFlowId) {
          await client.query("DELETE FROM elvanto_people_flow_links WHERE department_id=$1 AND source_flow_id=$2", [departmentId, sourceFlowId]);
        } else {
          await client.query(
            `INSERT INTO elvanto_people_flow_links(department_id,source_flow_id,local_flow_id)
             VALUES($1,$2,$3)
             ON CONFLICT(department_id,source_flow_id) DO UPDATE SET local_flow_id=EXCLUDED.local_flow_id,updated_at=now()`,
            [departmentId, sourceFlowId, localFlowId],
          );
          await client.query("DELETE FROM elvanto_people_flow_step_links WHERE department_id=$1 AND source_flow_id=$2", [departmentId, sourceFlowId]);
          for (const link of stepLinks) await client.query(
            "INSERT INTO elvanto_people_flow_step_links(department_id,source_flow_id,source_step_id,local_step_id) VALUES($1,$2,$3,$4)",
            [departmentId, sourceFlowId, link.sourceStepId, link.localStepId],
          );
        }
        await client.query(
          "INSERT INTO people_flow_audit(id,department_id,actor_user_id,action,flow_id,metadata) VALUES($1,$2,$3,'elvanto_crosswalk_updated',$4,$5::jsonb)",
          [randomUUID(), departmentId, request.authenticatedUser?.id ?? null, localFlowId, JSON.stringify({ sourceFlowId, linkedStepCount: localFlowId ? stepLinks.length : 0 })],
        );
        await client.query("COMMIT");
        context.realtime.publish("people-flows:changed", departmentId, { action: "elvanto_crosswalk_updated", flowId: localFlowId });
        return { saved: true, linkedSteps: localFlowId ? stepLinks.length : 0 };
      } catch (error) {
        await client.query("ROLLBACK");
        if ((error as { code?: string })?.code === "23505") return reply.code(409).send({ error: "This local workflow or step is already linked to another Elvanto record." });
        throw error;
      } finally {
        client.release();
      }
    });
  });
}
