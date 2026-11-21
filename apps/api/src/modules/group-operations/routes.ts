import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";

const uuid = { type: "string", format: "uuid" };
const date = { type: "string", format: "date" };

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation, realtime } = context;
  const unavailable = (reply: FastifyReply) => reply.code(503).send({ error: "Group operations are unavailable." });
  function canManage(request: FastifyRequest) {
    return request.activeDepartmentRole === "site_admin"
      || (request.activeDepartmentPermissions ?? []).includes("groups_manage")
      || (request.activeDepartmentModulePermissions?.["group-operations"] ?? []).includes("manage");
  }
  async function department(request: FastifyRequest, reply: FastifyReply, write = false) {
    if (!pool || !isDatabaseReady()) { unavailable(reply); return null; }
    const id = await resolveDepartmentId(request, reply);
    if (!id) return null;
    if (write && !canManage(request)) { reply.code(403).send({ error: "Group management access is required." }); return null; }
    return id;
  }
  async function existsInLocation(table: "church_groups" | "contacts", id: string, departmentId: string) {
    return (await pool!.query(`SELECT id FROM ${table} WHERE id=$1 AND department_id=$2`, [id, departmentId])).rowCount > 0;
  }
  async function canManageGroup(request: FastifyRequest, groupId: string, departmentId: string) {
    if (canManage(request)) return true;
    const result = await pool!.query(
      `SELECT 1 FROM group_members member JOIN department_memberships account ON account.contact_id=member.contact_id
        WHERE member.group_id=$1 AND account.department_id=$2 AND account.user_id=$3 AND member.status='active'
          AND lower(regexp_replace(member.role,'[^a-z]','','g')) IN ('leader','coleader','groupowner','groupmanager') LIMIT 1`,
      [groupId, departmentId, request.authenticatedUser?.id],
    );
    return Boolean(result.rowCount);
  }
  async function recordAudit(departmentId: string, groupId: string, request: FastifyRequest, action: string, recordId: string | null, details: object = {}) {
    await pool!.query("INSERT INTO group_operations_audit(id,department_id,group_id,actor_user_id,action,record_id,details) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)", [randomUUID(), departmentId, groupId, request.authenticatedUser?.id ?? null, action, recordId, JSON.stringify(details)]);
    realtime.publish("module:group-operations:changed", departmentId, { action, groupId, recordId });
  }

  app.get("/api/modules/group-operations/bootstrap", async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    const groups = await pool!.query("SELECT id,name,description FROM church_groups WHERE department_id=$1 ORDER BY lower(name),id LIMIT 2000", [departmentId]);
    return { groups: groups.rows, canManage: canManage(request) };
  });
  app.get<{ Querystring: { groupId?: string } }>("/api/modules/group-operations/members", async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    if (!request.query.groupId || !(await existsInLocation("church_groups", request.query.groupId, departmentId))) return reply.code(400).send({ error: "Choose a group from this location." });
    return (await pool!.query(`SELECT person.id,person.first_name AS "firstName",person.last_name AS "lastName",person.email,member.role
      FROM group_members member JOIN contacts person ON person.id=member.contact_id AND person.department_id=$1
      WHERE member.group_id=$2 AND member.status='active' ORDER BY person.last_name,person.first_name LIMIT 2000`, [departmentId, request.query.groupId])).rows;
  });

  app.get<{ Querystring: { groupId: string; meetingId?: string } }>("/api/modules/group-operations/meeting-feedback", {
    schema: { querystring: { type: "object", additionalProperties: false, required: ["groupId"], properties: { groupId: uuid, meetingId: uuid } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    if (!(await canManageGroup(request, request.query.groupId, departmentId))) return reply.code(403).send({ error: "Group leader access is required to view meeting feedback." });
    const meetings = await pool!.query(`SELECT id,meeting_date::text AS date,title FROM group_meetings WHERE department_id=$1 AND group_id=$2 ORDER BY meeting_date DESC,created_at DESC LIMIT 200`, [departmentId, request.query.groupId]);
    const template = await pool!.query(`SELECT id,title,questions,updated_at AS "updatedAt" FROM group_meeting_feedback_templates WHERE department_id=$1 AND group_id=$2`, [departmentId, request.query.groupId]);
    let response = null;
    if (request.query.meetingId) {
      const meeting = meetings.rows.find((row) => row.id === request.query.meetingId);
      if (!meeting) return reply.code(404).send({ error: "Meeting not found for this group." });
      const result = await pool!.query(`SELECT answers,created_at AS "createdAt",updated_at AS "updatedAt",COALESCE(actor.display_name,'Former user') AS "updatedBy"
        FROM group_meeting_feedback_responses feedback LEFT JOIN app_users actor ON actor.id=feedback.updated_by
        WHERE feedback.department_id=$1 AND feedback.group_id=$2 AND feedback.meeting_id=$3`, [departmentId, request.query.groupId, request.query.meetingId]);
      response = result.rows[0] ?? null;
    }
    return { meetings: meetings.rows, template: template.rows[0] ?? null, response };
  });

  app.put<{ Body: { groupId: string; title: string; questions: string[] } }>("/api/modules/group-operations/meeting-feedback/template", {
    schema: { body: { type: "object", additionalProperties: false, required: ["groupId", "title", "questions"], properties: { groupId: uuid, title: { type: "string", minLength: 1, maxLength: 120 }, questions: { type: "array", minItems: 1, maxItems: 10, items: { type: "string", minLength: 1, maxLength: 300 } } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    if (!(await canManageGroup(request, request.body.groupId, departmentId))) return reply.code(403).send({ error: "Group leader access is required to edit the feedback template." });
    const title = request.body.title.trim();
    const questions = request.body.questions.map((question) => question.trim());
    if (!title || questions.some((question) => !question)) return reply.code(400).send({ error: "Enter a title and non-empty prompts." });
    const old = await pool!.query<{ questions: Array<{ id: string; prompt: string }> }>("SELECT questions FROM group_meeting_feedback_templates WHERE department_id=$1 AND group_id=$2", [departmentId, request.body.groupId]);
    const priorQuestions = old.rows[0]?.questions ?? [];
    const prompts = questions.map((prompt, index) => ({ id: priorQuestions[index]?.prompt === prompt ? priorQuestions[index].id : randomUUID(), prompt }));
    const result = await pool!.query(`INSERT INTO group_meeting_feedback_templates(id,department_id,group_id,title,questions,created_by,updated_by)
      VALUES($1,$2,$3,$4,$5::jsonb,$6,$6)
      ON CONFLICT(department_id,group_id) DO UPDATE SET title=EXCLUDED.title,questions=EXCLUDED.questions,updated_by=EXCLUDED.updated_by,updated_at=now()
      RETURNING id,title,questions,updated_at AS "updatedAt"`, [randomUUID(), departmentId, request.body.groupId, title, JSON.stringify(prompts), request.authenticatedUser?.id ?? null]);
    await recordAudit(departmentId, request.body.groupId, request, "meeting_feedback_template_updated", result.rows[0].id, { promptCount: prompts.length });
    return result.rows[0];
  });

  app.put<{ Body: { groupId: string; meetingId: string; answers: Record<string, string> } }>("/api/modules/group-operations/meeting-feedback/responses", {
    schema: { body: { type: "object", additionalProperties: false, required: ["groupId", "meetingId", "answers"], properties: { groupId: uuid, meetingId: uuid, answers: { type: "object", maxProperties: 10, additionalProperties: { type: "string", maxLength: 2000 } } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    if (!(await canManageGroup(request, request.body.groupId, departmentId))) return reply.code(403).send({ error: "Group leader access is required to submit meeting feedback." });
    const meeting = await pool!.query("SELECT id FROM group_meetings WHERE id=$1 AND group_id=$2 AND department_id=$3", [request.body.meetingId, request.body.groupId, departmentId]);
    if (!meeting.rowCount) return reply.code(404).send({ error: "Meeting not found for this group." });
    const template = await pool!.query<{ questions: Array<{ id: string; prompt: string }> }>("SELECT questions FROM group_meeting_feedback_templates WHERE group_id=$1 AND department_id=$2", [request.body.groupId, departmentId]);
    if (!template.rowCount) return reply.code(409).send({ error: "Create a meeting feedback template before recording responses." });
    const questions = template.rows[0].questions;
    const allowedIds = new Set(questions.map((question) => question.id));
    if (Object.keys(request.body.answers).some((id) => !allowedIds.has(id))) return reply.code(400).send({ error: "The feedback form changed. Reload it before saving." });
    const answers = Object.fromEntries(Object.entries(request.body.answers).map(([id, value]) => [id, value.trim()]));
    const saved = await pool!.query(`INSERT INTO group_meeting_feedback_responses(id,department_id,group_id,meeting_id,answers,created_by,updated_by)
      VALUES($1,$2,$3,$4,$5::jsonb,$6,$6)
      ON CONFLICT(meeting_id) DO UPDATE SET answers=EXCLUDED.answers,updated_by=EXCLUDED.updated_by,updated_at=now()
      WHERE group_meeting_feedback_responses.department_id=EXCLUDED.department_id AND group_meeting_feedback_responses.group_id=EXCLUDED.group_id
      RETURNING id`, [randomUUID(), departmentId, request.body.groupId, request.body.meetingId, JSON.stringify(answers), request.authenticatedUser?.id ?? null]);
    if (!saved.rowCount) return reply.code(409).send({ error: "The meeting feedback belongs to a different group or location." });
    await recordAudit(departmentId, request.body.groupId, request, "meeting_feedback_saved", request.body.meetingId, { answerCount: Object.keys(answers).length });
    return { saved: true };
  });

  app.get<{ Querystring: { groupId?: string } }>("/api/modules/group-operations/routines", async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    const result = await pool!.query(`SELECT routine.id,routine.group_id AS "groupId",g.name AS "groupName",routine.name,routine.description,routine.cadence,routine.active,routine.updated_at AS "updatedAt"
      FROM group_routine_definitions routine JOIN church_groups g ON g.id=routine.group_id AND g.department_id=routine.department_id
      WHERE routine.department_id=$1 AND ($2::uuid IS NULL OR routine.group_id=$2) ORDER BY lower(g.name),lower(routine.name) LIMIT 2000`, [departmentId, request.query.groupId ?? null]);
    return result.rows;
  });
  app.post<{ Body: { groupId: string; name: string; description?: string; cadence?: string } }>("/api/modules/group-operations/routines", {
    schema: { body: { type: "object", additionalProperties: false, required: ["groupId", "name"], properties: { groupId: uuid, name: { type: "string", minLength: 1, maxLength: 120 }, description: { type: "string", maxLength: 1000 }, cadence: { type: "string", enum: ["manual", "weekly", "monthly", "quarterly", "annually"] } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    if (!(await existsInLocation("church_groups", request.body.groupId, departmentId))) return reply.code(404).send({ error: "Group not found in this location." });
    const name = request.body.name.trim(); if (!name) return reply.code(400).send({ error: "Enter a routine name." });
    const id = randomUUID();
    try { await pool!.query("INSERT INTO group_routine_definitions(id,department_id,group_id,name,description,cadence,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)", [id, departmentId, request.body.groupId, name, request.body.description?.trim() ?? "", request.body.cadence ?? "manual", request.authenticatedUser?.id ?? null]); }
    catch { return reply.code(409).send({ error: "Could not create this routine." }); }
    await recordAudit(departmentId, request.body.groupId, request, "routine_created", id, { name }); return reply.code(201).send({ id });
  });
  app.patch<{ Params: { id: string }; Body: { name: string; description: string; cadence: string; active: boolean } }>("/api/modules/group-operations/routines/:id", {
    schema: { params: { type: "object", required: ["id"], properties: { id: uuid } }, body: { type: "object", additionalProperties: false, required: ["name", "description", "cadence", "active"], properties: { name: { type: "string", minLength: 1, maxLength: 120 }, description: { type: "string", maxLength: 1000 }, cadence: { type: "string", enum: ["manual", "weekly", "monthly", "quarterly", "annually"] }, active: { type: "boolean" } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    const result = await pool!.query("UPDATE group_routine_definitions SET name=$3,description=$4,cadence=$5,active=$6,updated_at=now() WHERE id=$1 AND department_id=$2 RETURNING group_id AS \"groupId\"", [request.params.id, departmentId, request.body.name.trim(), request.body.description.trim(), request.body.cadence, request.body.active]);
    if (!result.rowCount) return reply.code(404).send({ error: "Routine not found." });
    await recordAudit(departmentId, result.rows[0].groupId, request, "routine_updated", request.params.id); return { updated: true };
  });
  app.get<{ Querystring: { groupId?: string } }>("/api/modules/group-operations/routine-runs", async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    const result = await pool!.query(`SELECT run.id,run.routine_id AS "routineId",routine.name AS "routineName",run.run_date::text AS "runDate",run.status,run.notes,
      run.assigned_contact_id AS "assignedContactId",concat_ws(' ',person.first_name,person.last_name) AS "assignedName",run.completed_at AS "completedAt"
      FROM group_routine_runs run JOIN group_routine_definitions routine ON routine.id=run.routine_id AND routine.department_id=run.department_id
      LEFT JOIN contacts person ON person.id=run.assigned_contact_id AND person.department_id=run.department_id
      WHERE run.department_id=$1 AND ($2::uuid IS NULL OR routine.group_id=$2) ORDER BY run.run_date DESC,run.created_at DESC LIMIT 1000`, [departmentId, request.query.groupId ?? null]);
    return result.rows;
  });
  app.post<{ Body: { routineId: string; runDate: string; assignedContactId?: string | null; notes?: string } }>("/api/modules/group-operations/routine-runs", {
    schema: { body: { type: "object", additionalProperties: false, required: ["routineId", "runDate"], properties: { routineId: uuid, runDate: date, assignedContactId: { anyOf: [uuid, { type: "null" }] }, notes: { type: "string", maxLength: 2000 } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    const routine = await pool!.query("SELECT group_id AS \"groupId\" FROM group_routine_definitions WHERE id=$1 AND department_id=$2 AND active=true", [request.body.routineId, departmentId]);
    if (!routine.rowCount) return reply.code(404).send({ error: "Active routine not found." });
    const groupId = routine.rows[0].groupId;
    if (request.body.assignedContactId) {
      const member = await pool!.query("SELECT 1 FROM group_members member JOIN contacts person ON person.id=member.contact_id AND person.department_id=$3 WHERE member.group_id=$1 AND member.contact_id=$2 AND member.status='active'", [groupId, request.body.assignedContactId, departmentId]);
      if (!member.rowCount) return reply.code(400).send({ error: "The assignee must be an active member of this group." });
    }
    const id = randomUUID();
    try { await pool!.query("INSERT INTO group_routine_runs(id,department_id,routine_id,run_date,assigned_contact_id,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)", [id, departmentId, request.body.routineId, request.body.runDate, request.body.assignedContactId ?? null, request.body.notes?.trim() ?? "", request.authenticatedUser?.id ?? null]); }
    catch { return reply.code(409).send({ error: "A run already exists for this routine and date, or the date is invalid." }); }
    await recordAudit(departmentId, groupId, request, "routine_run_created", id, { runDate: request.body.runDate }); return reply.code(201).send({ id });
  });
  app.patch<{ Params: { id: string }; Body: { status: "open" | "completed"; notes: string } }>("/api/modules/group-operations/routine-runs/:id", {
    schema: { params: { type: "object", required: ["id"], properties: { id: uuid } }, body: { type: "object", additionalProperties: false, required: ["status", "notes"], properties: { status: { type: "string", enum: ["open", "completed"] }, notes: { type: "string", maxLength: 2000 } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    const result = await pool!.query(`UPDATE group_routine_runs run SET status=$3,notes=$4,completed_by=CASE WHEN $3='completed' THEN $5 ELSE NULL END,completed_at=CASE WHEN $3='completed' THEN COALESCE(run.completed_at,now()) ELSE NULL END
      FROM group_routine_definitions routine WHERE run.id=$1 AND run.department_id=$2 AND routine.id=run.routine_id RETURNING routine.group_id AS "groupId"`, [request.params.id, departmentId, request.body.status, request.body.notes.trim(), request.authenticatedUser?.id ?? null]);
    if (!result.rowCount) return reply.code(404).send({ error: "Routine run not found." });
    await recordAudit(departmentId, result.rows[0].groupId, request, request.body.status === "completed" ? "routine_run_completed" : "routine_run_reopened", request.params.id); return { updated: true };
  });

  app.get<{ Querystring: { groupId?: string; status?: "open" | "completed"; assignedContactId?: string } }>("/api/modules/group-operations/follow-ups", {
    schema: { querystring: { type: "object", additionalProperties: false, properties: { groupId: uuid, status: { type: "string", enum: ["open", "completed"] }, assignedContactId: uuid } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply;
    if (request.query.groupId && !(await existsInLocation("church_groups", request.query.groupId, departmentId))) return reply.code(400).send({ error: "Choose a group from this location." });
    if (request.query.assignedContactId && !(await existsInLocation("contacts", request.query.assignedContactId, departmentId))) return reply.code(400).send({ error: "Choose an assignee from this location." });
    const result = await pool!.query(`SELECT task.id,task.group_id AS "groupId",group_row.name AS "groupName",task.contact_id AS "contactId",
        concat_ws(' ',person.first_name,person.last_name) AS "personName",task.assigned_contact_id AS "assignedContactId",
        concat_ws(' ',assignee.first_name,assignee.last_name) AS "assignedName",task.subject,task.note,task.due_date::text AS "dueDate",
        task.status,task.created_at AS "createdAt",task.completed_at AS "completedAt"
      FROM group_follow_up_tasks task JOIN church_groups group_row ON group_row.id=task.group_id AND group_row.department_id=task.department_id
      JOIN contacts person ON person.id=task.contact_id AND person.department_id=task.department_id
      LEFT JOIN contacts assignee ON assignee.id=task.assigned_contact_id AND assignee.department_id=task.department_id
      WHERE task.department_id=$1 AND ($2::uuid IS NULL OR task.group_id=$2) AND ($3::text IS NULL OR task.status=$3)
        AND ($4::uuid IS NULL OR task.assigned_contact_id=$4)
      ORDER BY (task.status='open') DESC,task.due_date,lower(group_row.name),lower(person.last_name),lower(person.first_name) LIMIT 3000`,
    [departmentId, request.query.groupId ?? null, request.query.status ?? null, request.query.assignedContactId ?? null]);
    return result.rows;
  });

  app.post<{ Body: { groupId: string; contactId: string; assignedContactId?: string | null; subject: string; note?: string; dueDate: string } }>("/api/modules/group-operations/follow-ups", {
    schema: { body: { type: "object", additionalProperties: false, required: ["groupId", "contactId", "subject", "dueDate"], properties: { groupId: uuid, contactId: uuid, assignedContactId: { anyOf: [uuid, { type: "null" }] }, subject: { type: "string", minLength: 1, maxLength: 160 }, note: { type: "string", maxLength: 2000 }, dueDate: date } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    const subject = request.body.subject.trim(); if (!subject) return reply.code(400).send({ error: "Enter a follow-up subject." });
    const client = await pool!.connect(); const id = randomUUID();
    try {
      await client.query("BEGIN");
      const group = await client.query<{ source_system: string | null }>("SELECT source_system FROM church_groups WHERE id=$1 AND department_id=$2 FOR SHARE", [request.body.groupId, departmentId]);
      if (!group.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Group not found in this location." }); }
      if (group.rows[0].source_system === "churchtools" || group.rows[0].source_system === "elvanto") { await client.query("ROLLBACK"); return reply.code(403).send({ error: "Follow-ups cannot be created for externally managed groups." }); }
      const memberIds = [...new Set([request.body.contactId, ...(request.body.assignedContactId ? [request.body.assignedContactId] : [])])];
      const members = await client.query("SELECT member.contact_id FROM group_members member JOIN contacts person ON person.id=member.contact_id AND person.department_id=$3 WHERE member.group_id=$1 AND member.contact_id=ANY($2::uuid[]) AND member.status='active'", [request.body.groupId, memberIds, departmentId]);
      if (members.rowCount !== memberIds.length) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "The person receiving follow-up and assignee must be active members of the selected group." }); }
      await client.query("INSERT INTO group_follow_up_tasks(id,department_id,group_id,contact_id,assigned_contact_id,subject,note,due_date,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [id, departmentId, request.body.groupId, request.body.contactId, request.body.assignedContactId ?? null, subject, request.body.note?.trim() ?? "", request.body.dueDate, request.authenticatedUser?.id ?? null]);
      await client.query("INSERT INTO group_operations_audit(id,department_id,group_id,actor_user_id,action,record_id,details) VALUES($1,$2,$3,$4,'follow_up_created',$5,$6::jsonb)", [randomUUID(), departmentId, request.body.groupId, request.authenticatedUser?.id ?? null, id, JSON.stringify({ contactId: request.body.contactId, assignedContactId: request.body.assignedContactId ?? null, subject, dueDate: request.body.dueDate })]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    realtime.publish("module:group-operations:changed", departmentId, { action: "follow_up_created", groupId: request.body.groupId, recordId: id });
    return reply.code(201).send({ id });
  });

  app.patch<{ Params: { id: string }; Body: { status: "open" | "completed"; note: string } }>("/api/modules/group-operations/follow-ups/:id", {
    schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } }, body: { type: "object", additionalProperties: false, required: ["status", "note"], properties: { status: { type: "string", enum: ["open", "completed"] }, note: { type: "string", maxLength: 2000 } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    const client = await pool!.connect(); let groupId = "";
    try {
      await client.query("BEGIN");
      const updated = await client.query<{ group_id: string }>(`UPDATE group_follow_up_tasks SET status=$3,note=$4,
        completed_by=CASE WHEN $3='completed' THEN $5 ELSE NULL END,completed_at=CASE WHEN $3='completed' THEN COALESCE(completed_at,now()) ELSE NULL END,updated_at=now()
        WHERE id=$1 AND department_id=$2 RETURNING group_id`, [request.params.id, departmentId, request.body.status, request.body.note.trim(), request.authenticatedUser?.id ?? null]);
      if (!updated.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Follow-up not found." }); }
      groupId = updated.rows[0].group_id;
      await client.query("INSERT INTO group_operations_audit(id,department_id,group_id,actor_user_id,action,record_id,details) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)", [randomUUID(), departmentId, groupId, request.authenticatedUser?.id ?? null, request.body.status === "completed" ? "follow_up_completed" : "follow_up_reopened", request.params.id, JSON.stringify({ status: request.body.status })]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    realtime.publish("module:group-operations:changed", departmentId, { action: request.body.status === "completed" ? "follow_up_completed" : "follow_up_reopened", groupId, recordId: request.params.id });
    return { updated: true };
  });

  app.get("/api/modules/group-operations/certificates", async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    const [definitions, issues] = await Promise.all([
      pool!.query(`SELECT cert.id,cert.group_id AS "groupId",g.name AS "groupName",cert.name,cert.description,cert.active FROM group_certificate_definitions cert JOIN church_groups g ON g.id=cert.group_id AND g.department_id=cert.department_id WHERE cert.department_id=$1 ORDER BY lower(g.name),lower(cert.name) LIMIT 2000`, [departmentId]),
      pool!.query(`SELECT issue.id,issue.certificate_id AS "certificateId",issue.group_id AS "groupId",issue.contact_id AS "contactId",cert.name AS "certificateName",g.name AS "groupName",concat_ws(' ',person.first_name,person.last_name) AS "personName",issue.issued_at::text AS "issuedAt",issue.valid_until::text AS "validUntil",issue.notes,issue.revoked_at AS "revokedAt",issue.revoke_reason AS "revokeReason" FROM group_certificate_issues issue JOIN group_certificate_definitions cert ON cert.id=issue.certificate_id AND cert.department_id=issue.department_id JOIN church_groups g ON g.id=issue.group_id AND g.department_id=issue.department_id JOIN contacts person ON person.id=issue.contact_id AND person.department_id=issue.department_id WHERE issue.department_id=$1 ORDER BY issue.issued_at DESC,person.last_name LIMIT 3000`, [departmentId]),
    ]);
    return { definitions: definitions.rows, issues: issues.rows };
  });
  app.post<{ Body: { groupId: string; name: string; description?: string } }>("/api/modules/group-operations/certificates", {
    schema: { body: { type: "object", additionalProperties: false, required: ["groupId", "name"], properties: { groupId: uuid, name: { type: "string", minLength: 1, maxLength: 120 }, description: { type: "string", maxLength: 1000 } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    if (!(await existsInLocation("church_groups", request.body.groupId, departmentId))) return reply.code(404).send({ error: "Group not found in this location." });
    const id = randomUUID(); await pool!.query("INSERT INTO group_certificate_definitions(id,department_id,group_id,name,description,created_by) VALUES($1,$2,$3,$4,$5,$6)", [id, departmentId, request.body.groupId, request.body.name.trim(), request.body.description?.trim() ?? "", request.authenticatedUser?.id ?? null]);
    await recordAudit(departmentId, request.body.groupId, request, "certificate_created", id, { name: request.body.name.trim() }); return reply.code(201).send({ id });
  });
  app.post<{ Body: { certificateId: string; contactId: string; issuedAt?: string; validUntil?: string | null; notes?: string } }>("/api/modules/group-operations/certificates/issue", {
    schema: { body: { type: "object", additionalProperties: false, required: ["certificateId", "contactId"], properties: { certificateId: uuid, contactId: uuid, issuedAt: date, validUntil: { anyOf: [date, { type: "null" }] }, notes: { type: "string", maxLength: 1000 } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    const cert = await pool!.query("SELECT group_id AS \"groupId\" FROM group_certificate_definitions WHERE id=$1 AND department_id=$2 AND active=true", [request.body.certificateId, departmentId]);
    if (!cert.rowCount) return reply.code(404).send({ error: "Active certificate definition not found." });
    const member = await pool!.query("SELECT 1 FROM group_members member JOIN contacts person ON person.id=member.contact_id AND person.department_id=$3 WHERE member.group_id=$1 AND member.contact_id=$2 AND member.status='active'", [cert.rows[0].groupId, request.body.contactId, departmentId]);
    if (!member.rowCount) return reply.code(400).send({ error: "Certificates can only be issued to active members of their group." });
    if (request.body.validUntil && request.body.issuedAt && request.body.validUntil < request.body.issuedAt) return reply.code(400).send({ error: "The expiry date must be on or after the issue date." });
    const id = randomUUID();
    try { await pool!.query("INSERT INTO group_certificate_issues(id,department_id,certificate_id,group_id,contact_id,issued_at,valid_until,notes,issued_by) VALUES($1,$2,$3,$4,$5,COALESCE($6::date,CURRENT_DATE),$7,$8,$9)", [id, departmentId, request.body.certificateId, cert.rows[0].groupId, request.body.contactId, request.body.issuedAt ?? null, request.body.validUntil ?? null, request.body.notes?.trim() ?? "", request.authenticatedUser?.id ?? null]); }
    catch { return reply.code(409).send({ error: "Could not issue this certificate." }); }
    await recordAudit(departmentId, cert.rows[0].groupId, request, "certificate_issued", id, { contactId: request.body.contactId }); return reply.code(201).send({ id });
  });
  app.post<{ Params: { id: string }; Body: { reason: string } }>("/api/modules/group-operations/certificates/:id/revoke", {
    schema: { params: { type: "object", required: ["id"], properties: { id: uuid } }, body: { type: "object", additionalProperties: false, required: ["reason"], properties: { reason: { type: "string", minLength: 1, maxLength: 500 } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    const result = await pool!.query("UPDATE group_certificate_issues SET revoked_at=now(),revoked_by=$3,revoke_reason=$4 WHERE id=$1 AND department_id=$2 AND revoked_at IS NULL RETURNING group_id AS \"groupId\"", [request.params.id, departmentId, request.authenticatedUser?.id ?? null, request.body.reason.trim()]);
    if (!result.rowCount) return reply.code(404).send({ error: "Active certificate issue not found." });
    await recordAudit(departmentId, result.rows[0].groupId, request, "certificate_revoked", request.params.id, { reason: request.body.reason.trim() }); return { revoked: true };
  });

  app.get("/api/modules/group-operations/membership-rules", async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    return (await pool!.query(`SELECT rule.id,rule.group_id AS "groupId",g.name AS "groupName",rule.name,rule.contact_status AS "contactStatus",rule.enabled,rule.updated_at AS "updatedAt"
      FROM group_membership_rule_sets rule JOIN church_groups g ON g.id=rule.group_id AND g.department_id=rule.department_id WHERE rule.department_id=$1 ORDER BY lower(g.name),lower(rule.name) LIMIT 2000`, [departmentId])).rows;
  });
  app.post<{ Body: { groupId: string; name: string; contactStatus: "member" | "visitor" } }>("/api/modules/group-operations/membership-rules", {
    schema: { body: { type: "object", additionalProperties: false, required: ["groupId", "name", "contactStatus"], properties: { groupId: uuid, name: { type: "string", minLength: 1, maxLength: 120 }, contactStatus: { type: "string", enum: ["member", "visitor"] } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    if (!(await existsInLocation("church_groups", request.body.groupId, departmentId))) return reply.code(404).send({ error: "Group not found in this location." });
    const id = randomUUID();
    try { await pool!.query("INSERT INTO group_membership_rule_sets(id,department_id,group_id,name,contact_status,created_by) VALUES($1,$2,$3,$4,$5,$6)", [id, departmentId, request.body.groupId, request.body.name.trim(), request.body.contactStatus, request.authenticatedUser?.id ?? null]); }
    catch { return reply.code(409).send({ error: "Could not save the membership rule." }); }
    await recordAudit(departmentId, request.body.groupId, request, "membership_rule_created", id, { contactStatus: request.body.contactStatus }); return reply.code(201).send({ id });
  });
  app.patch<{ Params: { id: string }; Body: { enabled: boolean } }>("/api/modules/group-operations/membership-rules/:id", {
    schema: { params: { type: "object", required: ["id"], properties: { id: uuid } }, body: { type: "object", additionalProperties: false, required: ["enabled"], properties: { enabled: { type: "boolean" } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    const result = await pool!.query("UPDATE group_membership_rule_sets SET enabled=$3,updated_at=now() WHERE id=$1 AND department_id=$2 RETURNING group_id AS \"groupId\"", [request.params.id, departmentId, request.body.enabled]);
    if (!result.rowCount) return reply.code(404).send({ error: "Membership rule not found." });
    await recordAudit(departmentId, result.rows[0].groupId, request, "membership_rule_updated", request.params.id, { enabled: request.body.enabled }); return { updated: true };
  });
  app.get<{ Params: { id: string } }>("/api/modules/group-operations/membership-rules/:id/preview", { schema: { params: { type: "object", required: ["id"], properties: { id: uuid } } } }, async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    const rule = await pool!.query("SELECT group_id AS \"groupId\",contact_status AS \"contactStatus\",name,enabled FROM group_membership_rule_sets WHERE id=$1 AND department_id=$2", [request.params.id, departmentId]);
    if (!rule.rowCount) return reply.code(404).send({ error: "Membership rule not found." });
    const group = await pool!.query("SELECT source_system FROM church_groups WHERE id=$1 AND department_id=$2", [rule.rows[0].groupId, departmentId]);
    if (group.rows[0]?.source_system === "churchtools" || group.rows[0]?.source_system === "elvanto") return reply.code(409).send({ error: "Membership rules cannot be applied to an externally managed group." });
    const result = await pool!.query(`SELECT contact.id,contact.first_name AS "firstName",contact.last_name AS "lastName",contact.email FROM contacts contact
      WHERE contact.department_id=$1 AND contact.status=$2 AND NOT EXISTS(SELECT 1 FROM group_members member WHERE member.group_id=$3 AND member.contact_id=contact.id)
      ORDER BY contact.last_name,contact.first_name LIMIT 500`, [departmentId, rule.rows[0].contactStatus, rule.rows[0].groupId]);
    return { rule: rule.rows[0], matches: result.rows, capped: result.rowCount === 500, previewOnly: true, applyEnabled: Boolean(rule.rows[0].enabled) };
  });
  app.post<{ Params: { id: string } }>("/api/modules/group-operations/membership-rules/:id/apply", { schema: { params: { type: "object", required: ["id"], properties: { id: uuid } } } }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      const rule = await client.query("SELECT group_id,contact_status,name,enabled FROM group_membership_rule_sets WHERE id=$1 AND department_id=$2 FOR UPDATE", [request.params.id, departmentId]);
      if (!rule.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Membership rule not found." }); }
      if (!rule.rows[0].enabled) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Enable this rule before applying it." }); }
      const group = await client.query("SELECT source_system FROM church_groups WHERE id=$1 AND department_id=$2 FOR UPDATE", [rule.rows[0].group_id, departmentId]);
      if (!group.rowCount || group.rows[0].source_system === "churchtools" || group.rows[0].source_system === "elvanto") { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Membership rules cannot be applied to an externally managed group." }); }
      await client.query("SELECT set_config('smart_church.actor_id',$1,true)", [request.authenticatedUser!.id]);
      await client.query("SELECT set_config('smart_church.department_id',$1,true)", [departmentId]);
      const inserted = await client.query(`WITH eligible AS (
          SELECT person.id FROM contacts person WHERE person.department_id=$1 AND person.status=$2
            AND NOT EXISTS(SELECT 1 FROM group_members current_member WHERE current_member.group_id=$3 AND current_member.contact_id=person.id)
          ORDER BY person.last_name,person.first_name LIMIT 500
        ) INSERT INTO group_members(group_id,contact_id,role,status,joined_on)
          SELECT $3,id,'Member','active',CURRENT_DATE FROM eligible
          ON CONFLICT(group_id,contact_id) DO NOTHING RETURNING contact_id`, [departmentId, rule.rows[0].contact_status, rule.rows[0].group_id]);
      await client.query("INSERT INTO group_operations_audit(id,department_id,group_id,actor_user_id,action,record_id,details) VALUES($1,$2,$3,$4,'membership_rule_applied',$5,$6::jsonb)", [randomUUID(), departmentId, rule.rows[0].group_id, request.authenticatedUser!.id, request.params.id, JSON.stringify({ added: inserted.rowCount, name: rule.rows[0].name })]);
      await client.query("COMMIT");
      realtime.publish("module:group-operations:changed", departmentId, { action: "membership_rule_applied", groupId: rule.rows[0].group_id, recordId: request.params.id });
      return { added: inserted.rowCount, limit: 500, truncatedPossible: inserted.rowCount === 500, removed: 0 };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });
}
