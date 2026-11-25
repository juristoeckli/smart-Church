import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";
import { saveGroupLeaderFeedback } from "../../group-leader-feedback.js";
import { renderCertificatePdf, renderCertificatePrintView, validCertificateTemplate, type Certificate } from "./certificate-document.js";
import { registerGroupOperationsReplication } from "./replication.js";

const uuid = { type: "string", format: "uuid" };
const date = { type: "string", format: "date" };
function followUpAudience(manager: string, userId: string) {
  return `(${manager} OR (
    group_row.status IN ('active','ended')
    AND group_row.source_system IS DISTINCT FROM 'churchtools' AND group_row.source_system IS DISTINCT FROM 'elvanto'
    AND EXISTS (
      SELECT 1 FROM department_memberships account
      JOIN group_members member ON member.contact_id=account.contact_id AND member.group_id=task.group_id AND member.status='active'
      WHERE account.user_id=${userId} AND account.department_id=task.department_id AND account.contact_id=task.assigned_contact_id
    )
  ))`;
}

function certificateIssueAudience(isManager: string, userId: string) {
  return `(${isManager} OR EXISTS (
    SELECT 1 FROM department_memberships membership
     WHERE membership.department_id=issue.department_id AND membership.user_id=${userId} AND membership.contact_id=issue.contact_id
  ))`;
}
function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function anonymousResponseToken(request: FastifyRequest) {
  const token = request.headers["x-feedback-response-token"];
  return typeof token === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)
    ? createHash("sha256").update(token).digest("hex")
    : null;
}

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation, realtime } = context;
  registerGroupOperationsReplication(context);
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
    const db = pool as NonNullable<typeof pool>;
    if (!db) return false;
    const result = await db!.query(`SELECT id FROM ${table} WHERE id=$1 AND department_id=$2`, [id, departmentId]);
    return (result?.rowCount ?? 0) > 0;
  }
  async function canManageGroup(request: FastifyRequest, groupId: string, departmentId: string) {
    if (canManage(request)) return true;
    const result = await pool!.query(
      `SELECT 1 FROM group_members member
         JOIN department_memberships account ON account.contact_id=member.contact_id
         JOIN church_groups church_group ON church_group.id=member.group_id AND church_group.department_id=$2
        WHERE member.group_id=$1 AND account.department_id=$2 AND account.user_id=$3 AND member.status='active'
          AND regexp_replace(lower(member.role),'[^a-z]','','g') IN ('leader','coleader','groupowner','groupmanager') LIMIT 1`,
      [groupId, departmentId, request.authenticatedUser?.id],
    );
    return Boolean(result.rowCount);
  }
  async function activeGroupContact(request: FastifyRequest, groupId: string, departmentId: string) {
    const result = await pool!.query<{ contactId: string }>(
      `SELECT member.contact_id AS "contactId"
         FROM group_members member
         JOIN department_memberships account ON account.contact_id=member.contact_id AND account.department_id=$2 AND account.user_id=$3
         JOIN church_groups group_row ON group_row.id=member.group_id AND group_row.department_id=$2
        WHERE member.group_id=$1 AND member.status='active' LIMIT 1`,
      [groupId, departmentId, request.authenticatedUser?.id],
    );
    return result.rows[0]?.contactId ?? null;
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
    const canManageFeedback = await canManageGroup(request, request.query.groupId, departmentId);
    const canSubmitFeedback = Boolean(await activeGroupContact(request, request.query.groupId, departmentId));
    if (!canManageFeedback && !canSubmitFeedback) return reply.code(403).send({ error: "Active group membership is required to view meeting feedback." });
    const meetings = await pool!.query(
      `SELECT meeting.id,meeting.meeting_date::text AS date,meeting.title,meeting.attendance_completed_at AS "completedAt",feedback.guest_count AS "guestCount"
         FROM group_meetings meeting
         LEFT JOIN group_meeting_feedback_responses feedback
           ON $3 AND feedback.department_id=meeting.department_id AND feedback.group_id=meeting.group_id AND feedback.meeting_id=meeting.id
        WHERE meeting.department_id=$1 AND meeting.group_id=$2
        ORDER BY meeting.meeting_date DESC,meeting.created_at DESC LIMIT 200`,
      [departmentId, request.query.groupId, canManageFeedback],
    );
    const template = await pool!.query(`SELECT id,title,questions,anonymous_attendee_responses AS "anonymousAttendeeResponses",updated_at AS "updatedAt" FROM group_meeting_feedback_templates WHERE department_id=$1 AND group_id=$2`, [departmentId, request.query.groupId]);
    let response = null;
    if (request.query.meetingId) {
      const meeting = meetings.rows.find((row) => row.id === request.query.meetingId);
      if (!meeting) return reply.code(404).send({ error: "Meeting not found for this group." });
      const result = canManageFeedback ? await pool!.query(`SELECT answers,meeting_comment AS "comment",guest_count AS "guestCount",created_at AS "createdAt",updated_at AS "updatedAt",COALESCE(actor.display_name,'Former user') AS "updatedBy"
        FROM group_meeting_feedback_responses feedback LEFT JOIN app_users actor ON actor.id=feedback.updated_by
        WHERE feedback.department_id=$1 AND feedback.group_id=$2 AND feedback.meeting_id=$3`, [departmentId, request.query.groupId, request.query.meetingId]) : { rows: [] };
      response = result.rows[0] ?? null;
    }
    return { meetings: meetings.rows, template: template.rows[0] ?? null, response, canManageFeedback, canSubmitFeedback };
  });

  app.get<{ Querystring: { groupId: string } }>("/api/modules/group-operations/meeting-feedback/eligibility", {
    schema: { querystring: { type: "object", additionalProperties: false, required: ["groupId"], properties: { groupId: uuid } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    if (!(await existsInLocation("church_groups", request.query.groupId, departmentId))) return reply.code(404).send({ error: "Group not found in this location." });
    return { canSubmitFeedback: Boolean(await activeGroupContact(request, request.query.groupId, departmentId)), canManageFeedback: await canManageGroup(request, request.query.groupId, departmentId) };
  });

  app.get<{ Querystring: { groupId: string; meetingId: string } }>("/api/modules/group-operations/meeting-feedback/attendees", {
    schema: { querystring: { type: "object", additionalProperties: false, required: ["groupId", "meetingId"], properties: { groupId: uuid, meetingId: uuid } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    const contactId = await activeGroupContact(request, request.query.groupId, departmentId);
    const canViewResponses = await canManageGroup(request, request.query.groupId, departmentId);
    if (!contactId && !canViewResponses) return reply.code(403).send({ error: "An active group membership and linked location account are required." });
    const meeting = await pool!.query<{ date: string; feedbackOpen: boolean }>("SELECT meeting_date::text AS date,(meeting_date<=CURRENT_DATE) AS \"feedbackOpen\" FROM group_meetings WHERE id=$1 AND group_id=$2 AND department_id=$3", [request.query.meetingId, request.query.groupId, departmentId]);
    if (!meeting.rowCount) return reply.code(404).send({ error: "Meeting not found for this group." });
    const template = await pool!.query("SELECT id,title,questions,anonymous_attendee_responses AS \"anonymousAttendeeResponses\",updated_at AS \"updatedAt\" FROM group_meeting_feedback_templates WHERE department_id=$1 AND group_id=$2", [departmentId, request.query.groupId]);
    if (!template.rowCount) return reply.code(409).send({ error: "This group has no meeting feedback template." });
    const anonymous = Boolean(template.rows[0].anonymousAttendeeResponses);
    const responseTokenHash = anonymous ? anonymousResponseToken(request) : null;
    const mine = anonymous
      ? responseTokenHash ? await pool!.query("SELECT answers,updated_at AS \"updatedAt\" FROM group_meeting_feedback_attendee_submissions WHERE department_id=$1 AND group_id=$2 AND meeting_id=$3 AND contact_id IS NULL AND anonymous_response_token_hash=$4", [departmentId, request.query.groupId, request.query.meetingId, responseTokenHash]) : { rows: [] }
      : contactId ? await pool!.query("SELECT answers,updated_at AS \"updatedAt\" FROM group_meeting_feedback_attendee_submissions WHERE department_id=$1 AND group_id=$2 AND meeting_id=$3 AND contact_id=$4", [departmentId, request.query.groupId, request.query.meetingId, contactId]) : { rows: [] };
    const responses = !canViewResponses ? { rows: [] } : anonymous ? await pool!.query(
      `SELECT 'Anonymous response' AS "respondentLabel",submission.answers,NULL::timestamptz AS "updatedAt"
         FROM group_meeting_feedback_attendee_submissions submission
        WHERE submission.department_id=$1 AND submission.group_id=$2 AND submission.meeting_id=$3 AND submission.contact_id IS NULL
        ORDER BY submission.created_at,submission.id`,
      [departmentId, request.query.groupId, request.query.meetingId],
    ) : await pool!.query(
      `SELECT concat_ws(' ',person.first_name,person.last_name) AS "respondentLabel",
              submission.answers,submission.updated_at AS "updatedAt"
         FROM group_meeting_feedback_attendee_submissions submission
         JOIN contacts person ON person.id=submission.contact_id AND person.department_id=submission.department_id
        WHERE submission.department_id=$1 AND submission.group_id=$2 AND submission.meeting_id=$3
        ORDER BY lower(person.last_name),lower(person.first_name),person.id`,
      [departmentId, request.query.groupId, request.query.meetingId],
    );
    return { meetingDate: meeting.rows[0].date, feedbackOpen: meeting.rows[0].feedbackOpen, template: template.rows[0], myResponse: mine.rows[0] ?? null, responses: responses.rows, canViewResponses, canSubmit: Boolean(contactId && meeting.rows[0].feedbackOpen) };
  });

  app.put<{ Body: { groupId: string; meetingId: string; answers: Record<string, string>; responseToken?: string } }>("/api/modules/group-operations/meeting-feedback/attendees", {
    schema: { body: { type: "object", additionalProperties: false, required: ["groupId", "meetingId", "answers"], properties: { groupId: uuid, meetingId: uuid, answers: { type: "object", maxProperties: 10, additionalProperties: { type: "string", maxLength: 2000 } }, responseToken: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    const client = await pool!.connect();
    let contactId: string | null = null;
    let anonymousResponse = false;
    let answerCount = 0;
    try {
      await client.query("BEGIN");
      const membership = await client.query<{ contact_id: string }>(
        `SELECT member.contact_id FROM group_members member
         JOIN department_memberships account ON account.contact_id=member.contact_id AND account.department_id=$2 AND account.user_id=$3
         JOIN church_groups group_row ON group_row.id=member.group_id AND group_row.department_id=$2
         WHERE member.group_id=$1 AND member.status='active' FOR SHARE OF member,account`,
        [request.body.groupId, departmentId, request.authenticatedUser?.id],
      );
      if (!membership.rowCount) { await client.query("ROLLBACK"); return reply.code(403).send({ error: "An active group membership and linked location account are required." }); }
      contactId = membership.rows[0].contact_id;
      const meeting = await client.query("SELECT id FROM group_meetings WHERE id=$1 AND group_id=$2 AND department_id=$3 AND meeting_date<=CURRENT_DATE FOR SHARE", [request.body.meetingId, request.body.groupId, departmentId]);
      if (!meeting.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Meeting not found, or attendee feedback is not open before its date." }); }
      const template = await client.query<{ questions: Array<{ id: string; prompt: string; required?: boolean }>; anonymous_attendee_responses: boolean }>("SELECT questions,anonymous_attendee_responses FROM group_meeting_feedback_templates WHERE group_id=$1 AND department_id=$2 FOR SHARE", [request.body.groupId, departmentId]);
      if (!template.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Create a meeting feedback template before responses can be submitted." }); }
      anonymousResponse = template.rows[0].anonymous_attendee_responses;
      const allowedIds = new Set(template.rows[0].questions.map((question) => question.id));
      if (Object.keys(request.body.answers).some((id) => !allowedIds.has(id))) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "The feedback form changed. Reload it before saving." }); }
      const answers = Object.fromEntries(Object.entries(request.body.answers).map(([id, value]) => [id, value.trim()]));
      const missingRequired = template.rows[0].questions.filter((question) => question.required && !answers[question.id]);
      if (missingRequired.length) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Answer all required feedback prompts before saving." }); }
      answerCount = Object.keys(answers).length;
      let saved;
      if (template.rows[0].anonymous_attendee_responses) {
        if (!request.body.responseToken || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.body.responseToken)) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "An anonymous response key is required. Reload the form and try again." }); }
        const tokenHash = createHash("sha256").update(request.body.responseToken).digest("hex");
        saved = await client.query(
          `INSERT INTO group_meeting_feedback_attendee_submissions(id,department_id,group_id,meeting_id,contact_id,anonymous_response_token_hash,answers,created_by,updated_by)
           VALUES($1,$2,$3,$4,NULL,$5,$6::jsonb,NULL,NULL)
           ON CONFLICT(meeting_id,anonymous_response_token_hash) WHERE anonymous_response_token_hash IS NOT NULL
           DO UPDATE SET answers=EXCLUDED.answers,updated_at=now()
           WHERE group_meeting_feedback_attendee_submissions.department_id=EXCLUDED.department_id AND group_meeting_feedback_attendee_submissions.group_id=EXCLUDED.group_id
           RETURNING id`,
          [randomUUID(), departmentId, request.body.groupId, request.body.meetingId, tokenHash, JSON.stringify(answers)],
        );
      } else {
        saved = await client.query(
          `INSERT INTO group_meeting_feedback_attendee_submissions(id,department_id,group_id,meeting_id,contact_id,answers,created_by,updated_by)
           VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$7)
           ON CONFLICT(meeting_id,contact_id) DO UPDATE SET answers=EXCLUDED.answers,updated_by=EXCLUDED.updated_by,updated_at=now()
           WHERE group_meeting_feedback_attendee_submissions.department_id=EXCLUDED.department_id AND group_meeting_feedback_attendee_submissions.group_id=EXCLUDED.group_id
           RETURNING id`,
          [randomUUID(), departmentId, request.body.groupId, request.body.meetingId, contactId, JSON.stringify(answers), request.authenticatedUser?.id ?? null],
        );
      }
      if (!saved.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "The response belongs to another group or location." }); }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    if (anonymousResponse) {
      await pool!.query("INSERT INTO group_operations_audit(id,department_id,group_id,actor_user_id,action,record_id,details) VALUES($1,$2,$3,NULL,'attendee_meeting_feedback_saved',$4,$5::jsonb)", [randomUUID(), departmentId, request.body.groupId, request.body.meetingId, JSON.stringify({ anonymous: true, answerCount })]);
      realtime.publish("module:group-operations:changed", departmentId, { action: "attendee_meeting_feedback_saved", groupId: request.body.groupId, recordId: request.body.meetingId });
    } else {
      await recordAudit(departmentId, request.body.groupId, request, "attendee_meeting_feedback_saved", request.body.meetingId, { contactId, answerCount });
    }
    return { saved: true };
  });

  app.get<{ Querystring: { groupId: string } }>("/api/modules/group-operations/meeting-feedback/export", {
    schema: { querystring: { type: "object", additionalProperties: false, required: ["groupId"], properties: { groupId: uuid } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    if (!(await canManageGroup(request, request.query.groupId, departmentId))) return reply.code(403).send({ error: "Group leader access is required to export meeting feedback." });
    const template = await pool!.query<{ title: string; questions: Array<{ id: string; prompt: string }> }>(
      "SELECT title,questions FROM group_meeting_feedback_templates WHERE department_id=$1 AND group_id=$2",
      [departmentId, request.query.groupId],
    );
    const responses = await pool!.query<{ date: string; meeting_title: string | null; response_type: string; respondent: string | null; answers: Record<string, string>; updated_by: string | null; updated_at: Date | string | null; meeting_comment: string | null; guest_count: number | null }>(
      `WITH feedback_rows AS (
         SELECT meeting_id,answers,'Leader'::text AS response_type,NULL::text AS respondent,feedback.meeting_comment,feedback.guest_count,
                COALESCE(actor.display_name,'Former user') AS updated_by,feedback.updated_at
           FROM group_meeting_feedback_responses feedback LEFT JOIN app_users actor ON actor.id=feedback.updated_by
          WHERE feedback.department_id=$1 AND feedback.group_id=$2
         UNION ALL
         SELECT submission.meeting_id,submission.answers,'Attendee'::text AS response_type,
                concat_ws(' ',person.first_name,person.last_name) AS respondent,NULL::text,NULL::int,
                COALESCE(actor.display_name,'Former user') AS updated_by,submission.updated_at
           FROM group_meeting_feedback_attendee_submissions submission
           JOIN contacts person ON person.id=submission.contact_id AND person.department_id=submission.department_id
           LEFT JOIN app_users actor ON actor.id=submission.updated_by
          WHERE submission.department_id=$1 AND submission.group_id=$2 AND submission.contact_id IS NOT NULL
         UNION ALL
         SELECT submission.meeting_id,submission.answers,'Attendee'::text AS response_type,
                'Anonymous response'::text AS respondent,NULL::text,NULL::int,NULL::text AS updated_by,NULL::timestamptz AS updated_at
           FROM group_meeting_feedback_attendee_submissions submission
          WHERE submission.department_id=$1 AND submission.group_id=$2 AND submission.contact_id IS NULL
       )
       SELECT meeting.meeting_date::text AS date,meeting.title AS meeting_title,feedback.response_type,feedback.respondent,feedback.answers,
              feedback.updated_by,feedback.updated_at,feedback.meeting_comment,feedback.guest_count
         FROM feedback_rows feedback
         JOIN group_meetings meeting ON meeting.id=feedback.meeting_id AND meeting.department_id=$1 AND meeting.group_id=$2
        ORDER BY meeting.meeting_date,meeting.created_at,meeting.id,feedback.response_type,feedback.respondent`,
      [departmentId, request.query.groupId],
    );
    const questions = template.rows[0]?.questions ?? [];
    const rows = [
      ["Meeting date", "Meeting", "Feedback form", "Response type", "Respondent", "Updated by", "Updated at", "Guest count", "Meeting comment", ...questions.map((question) => question.prompt)],
      ...responses.rows.map((response) => [response.date, response.meeting_title, template.rows[0]?.title ?? "", response.response_type, response.respondent, response.updated_by, response.updated_at ? new Date(response.updated_at).toISOString() : "", response.guest_count, response.meeting_comment, ...questions.map((question) => response.answers?.[question.id] ?? "")]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    return reply.header("cache-control", "private, no-store").type("text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="group-meeting-feedback-${request.query.groupId}.csv"`).send(csv);
  });

  app.put<{ Body: { groupId: string; title: string; questions: Array<string | { prompt: string; required?: boolean }>; anonymousAttendeeResponses?: boolean } }>("/api/modules/group-operations/meeting-feedback/template", {
    schema: { body: { type: "object", additionalProperties: false, required: ["groupId", "title", "questions"], properties: { groupId: uuid, title: { type: "string", minLength: 1, maxLength: 120 }, questions: { type: "array", minItems: 1, maxItems: 10, items: { anyOf: [{ type: "string", minLength: 1, maxLength: 300 }, { type: "object", additionalProperties: false, required: ["prompt"], properties: { prompt: { type: "string", minLength: 1, maxLength: 300 }, required: { type: "boolean" } } }] } }, anonymousAttendeeResponses: { type: "boolean" } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    if (!(await canManageGroup(request, request.body.groupId, departmentId))) return reply.code(403).send({ error: "Group leader access is required to edit the feedback template." });
    const title = request.body.title.trim();
    const questions = request.body.questions.map((question) => typeof question === "string" ? { prompt: question.trim(), required: undefined } : { prompt: question.prompt.trim(), required: question.required });
    if (!title || questions.some((question) => !question.prompt)) return reply.code(400).send({ error: "Enter a title and non-empty prompts." });
    const client = await pool!.connect();
    let result;
    try {
      await client.query("BEGIN");
      const old = await client.query<{ questions: Array<{ id: string; prompt: string; required?: boolean }>; anonymous_attendee_responses: boolean }>("SELECT questions,anonymous_attendee_responses FROM group_meeting_feedback_templates WHERE department_id=$1 AND group_id=$2 FOR UPDATE", [departmentId, request.body.groupId]);
      const priorQuestions = old.rows[0]?.questions ?? [];
      const anonymousAttendeeResponses = request.body.anonymousAttendeeResponses ?? old.rows[0]?.anonymous_attendee_responses ?? false;
      if (old.rowCount && anonymousAttendeeResponses !== old.rows[0].anonymous_attendee_responses) {
        const existingResponses = await client.query("SELECT 1 FROM group_meeting_feedback_attendee_submissions WHERE department_id=$1 AND group_id=$2 LIMIT 1", [departmentId, request.body.groupId]);
        if (existingResponses.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Response privacy cannot be changed after attendees have responded. Keep the current setting; earlier responses keep their original privacy." }); }
      }
      const prompts = questions.map(({ prompt, required }, index) => {
        const prior = priorQuestions[index]?.prompt === prompt ? priorQuestions[index] : undefined;
        return { id: prior?.id ?? randomUUID(), prompt, required: required ?? prior?.required ?? false };
      });
      result = await client.query(`INSERT INTO group_meeting_feedback_templates(id,department_id,group_id,title,questions,anonymous_attendee_responses,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$7)
        ON CONFLICT(department_id,group_id) DO UPDATE SET title=EXCLUDED.title,questions=EXCLUDED.questions,anonymous_attendee_responses=EXCLUDED.anonymous_attendee_responses,updated_by=EXCLUDED.updated_by,updated_at=now()
        RETURNING id,title,questions,anonymous_attendee_responses AS "anonymousAttendeeResponses",updated_at AS "updatedAt"`, [randomUUID(), departmentId, request.body.groupId, title, JSON.stringify(prompts), anonymousAttendeeResponses, request.authenticatedUser?.id ?? null]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    await recordAudit(departmentId, request.body.groupId, request, "meeting_feedback_template_updated", result.rows[0].id, { promptCount: result.rows[0].questions.length, anonymousAttendeeResponses: result.rows[0].anonymousAttendeeResponses });
    return result.rows[0];
  });

  app.put<{ Body: { groupId: string; meetingId: string; answers: Record<string, string>; comment?: string; guestCount?: number | null } }>("/api/modules/group-operations/meeting-feedback/responses", {
    schema: { body: { type: "object", additionalProperties: false, required: ["groupId", "meetingId", "answers"], properties: { groupId: uuid, meetingId: uuid, answers: { type: "object", maxProperties: 10, additionalProperties: { type: "string", maxLength: 2000 } }, comment: { type: "string", maxLength: 2000 }, guestCount: { type: ["integer", "null"], minimum: 0, maximum: 100000 } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    if (!(await canManageGroup(request, request.body.groupId, departmentId))) return reply.code(403).send({ error: "Group leader access is required to submit meeting feedback." });
    const { groupId, meetingId } = request.body;
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      const meeting = (await client.query<{ attendance_completed_at: Date | null }>(
        "SELECT attendance_completed_at FROM group_meetings WHERE id=$1 AND group_id=$2 AND department_id=$3 FOR UPDATE",
        [meetingId, groupId, departmentId],
      )).rows[0];
      if (!meeting) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Meeting not found for this group." }); }
      if (meeting.attendance_completed_at) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Reopen attendance before changing this meeting's leader feedback." });
      }
      const failure = await saveGroupLeaderFeedback(client, { groupId, meetingId, departmentId }, request.body, request.authenticatedUser?.id ?? null);
      if (failure) {
        await client.query("ROLLBACK");
        return reply.code(failure.status).send({ error: failure.error });
      }
      await client.query("COMMIT");
      realtime.publish("module:group-operations:changed", departmentId, { action: "meeting_feedback_saved", groupId, recordId: meetingId });
      return { saved: true };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
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
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    const manager = canManage(request);
    if (request.query.groupId && !(await existsInLocation("church_groups", request.query.groupId, departmentId))) return reply.code(400).send({ error: "Choose a group from this location." });
    if (manager && request.query.assignedContactId && !(await existsInLocation("contacts", request.query.assignedContactId, departmentId))) return reply.code(400).send({ error: "Choose an assignee from this location." });
    const result = await pool!.query(`SELECT task.id,task.group_id AS "groupId",group_row.name AS "groupName",task.contact_id AS "contactId",
        concat_ws(' ',person.first_name,person.last_name) AS "personName",task.assigned_contact_id AS "assignedContactId",
        concat_ws(' ',assignee.first_name,assignee.last_name) AS "assignedName",task.subject,CASE WHEN $5 THEN task.note ELSE '' END AS note,task.due_date::text AS "dueDate",
        CASE WHEN task.status='completed' THEN 'completed'
             WHEN task.due_date=local_day.today THEN 'due'
             WHEN task.due_date<local_day.today THEN 'overdue' ELSE 'upcoming' END AS "dueState",
        task.status,task.created_at AS "createdAt",task.completed_at AS "completedAt"
      FROM group_follow_up_tasks task JOIN church_groups group_row ON group_row.id=task.group_id AND group_row.department_id=task.department_id
      JOIN departments site ON site.id=task.department_id
      LEFT JOIN pg_timezone_names zone ON zone.name=site.time_zone
      CROSS JOIN LATERAL (SELECT (current_timestamp AT TIME ZONE COALESCE(zone.name,'UTC'))::date AS today) local_day
      JOIN contacts person ON person.id=task.contact_id AND person.department_id=task.department_id
      LEFT JOIN contacts assignee ON assignee.id=task.assigned_contact_id AND assignee.department_id=task.department_id
      WHERE task.department_id=$1 AND ($2::uuid IS NULL OR task.group_id=$2) AND ($3::text IS NULL OR task.status=$3)
        AND ($4::uuid IS NULL OR task.assigned_contact_id=$4) AND ${followUpAudience("$5", "$6")}
      ORDER BY (task.status='open') DESC,task.due_date,lower(group_row.name),lower(person.last_name),lower(person.first_name) LIMIT 3000`,
    [departmentId, request.query.groupId ?? null, request.query.status ?? null, request.query.assignedContactId ?? null, manager, request.authenticatedUser?.id ?? null]);
    reply.header("cache-control", "private, no-store");
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

  app.patch<{ Params: { id: string }; Body: { status?: "open" | "completed"; note?: string; dueDate?: string; expectedDueDate?: string } }>("/api/modules/group-operations/follow-ups/:id", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } },
      body: { type: "object", additionalProperties: false, anyOf: [{ required: ["status"] }, { required: ["note"] }, { required: ["dueDate"] }],
        properties: { status: { type: "string", enum: ["open", "completed"] }, note: { type: "string", maxLength: 2000 }, dueDate: date, expectedDueDate: date },
      },
    },
  }, async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    const manager = canManage(request);
    const actor = request.authenticatedUser?.id ?? null;
    const { status, note, dueDate, expectedDueDate } = request.body;
    if (!manager && note !== undefined) return reply.code(403).send({ error: "Only a group manager can edit private follow-up notes." });
    const client = await pool!.connect();
    let transition: { groupId: string; action: string } | undefined;
    try {
      await client.query("BEGIN");
      const result = await client.query<{ group_id: string; status: "open" | "completed"; note: string; due_date: string }>(
        `SELECT task.group_id,task.status,task.note,task.due_date::text AS due_date
           FROM group_follow_up_tasks task
           JOIN church_groups group_row ON group_row.id=task.group_id AND group_row.department_id=task.department_id
          WHERE task.id=$1 AND task.department_id=$2 AND ${followUpAudience("$3", "$4")}
          FOR UPDATE OF task`,
        [request.params.id, departmentId, manager, actor],
      );
      const before = result.rows[0];
      if (!before) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Follow-up not found." }); }
      const nextStatus = status ?? before.status;
      const nextDate = dueDate ?? before.due_date;
      const nextNote = note === undefined ? before.note : note.trim();
      if (dueDate && expectedDueDate && expectedDueDate !== before.due_date) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "The due date changed. Reload the follow-up before rescheduling." });
      }
      if (nextDate !== before.due_date && nextStatus === "completed") {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Reopen this follow-up before changing its due date." });
      }
      if (nextStatus !== before.status || nextDate !== before.due_date || nextNote !== before.note) {
        const updated = await client.query(`UPDATE group_follow_up_tasks AS task SET status=$3::varchar,due_date=$4,note=$5,
            completed_by=CASE WHEN $3::varchar='open' THEN NULL WHEN task.status='open' THEN $6 ELSE completed_by END,
            completed_at=CASE WHEN $3::varchar='open' THEN NULL WHEN task.status='open' THEN now() ELSE completed_at END,updated_at=now()
          FROM church_groups group_row
          WHERE task.id=$1 AND task.department_id=$2 AND group_row.id=task.group_id AND group_row.department_id=task.department_id
            AND ${followUpAudience("$7", "$6")}
          RETURNING task.id`, [request.params.id, departmentId, nextStatus, nextDate, nextNote, actor, manager]);
        if (!updated.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Follow-up not found." }); }
        const action = nextStatus !== before.status ? (nextStatus === "completed" ? "follow_up_completed" : "follow_up_reopened")
          : nextDate !== before.due_date ? "follow_up_rescheduled" : "follow_up_note_updated";
        const details = nextDate === before.due_date ? { status: nextStatus } : { status: nextStatus, previousDueDate: before.due_date, dueDate: nextDate };
        await client.query(
          "INSERT INTO group_operations_audit(id,department_id,group_id,actor_user_id,action,record_id,details) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
          [randomUUID(), departmentId, before.group_id, actor, action, request.params.id, JSON.stringify(details)],
        );
        transition = { groupId: before.group_id, action };
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    if (transition) realtime.publish("module:group-operations:changed", departmentId, { ...transition, recordId: request.params.id });
    return { updated: true };
  });


  app.get("/api/modules/group-operations/certificates", async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    const manager = canManage(request);
    const [definitions, issues] = await Promise.all([
      manager ? pool!.query(`SELECT cert.id,cert.group_id AS "groupId",g.name AS "groupName",cert.name,cert.description,cert.active FROM group_certificate_definitions cert JOIN church_groups g ON g.id=cert.group_id AND g.department_id=cert.department_id WHERE cert.department_id=$1 ORDER BY lower(g.name),lower(cert.name) LIMIT 2000`, [departmentId]) : Promise.resolve({ rows: [] }),
      pool!.query(`SELECT issue.id,issue.certificate_id AS "certificateId",issue.group_id AS "groupId",issue.contact_id AS "contactId",cert.name AS "certificateName",g.name AS "groupName",concat_ws(' ',person.first_name,person.last_name) AS "personName",issue.issued_at::text AS "issuedAt",issue.valid_until::text AS "validUntil",CASE WHEN $2 THEN issue.notes ELSE '' END AS notes,issue.revoked_at AS "revokedAt",CASE WHEN $2 THEN issue.revoke_reason ELSE '' END AS "revokeReason" FROM group_certificate_issues issue JOIN group_certificate_definitions cert ON cert.id=issue.certificate_id AND cert.department_id=issue.department_id JOIN church_groups g ON g.id=issue.group_id AND g.department_id=issue.department_id JOIN contacts person ON person.id=issue.contact_id AND person.department_id=issue.department_id WHERE issue.department_id=$1 AND ${certificateIssueAudience("$2", "$3")} ORDER BY issue.issued_at DESC,person.last_name LIMIT 3000`, [departmentId, manager, request.authenticatedUser?.id ?? null]),
    ]);
    reply.header("cache-control", "private, no-store");
    return { definitions: definitions.rows, issues: issues.rows };
  });
  app.get<{ Params: { id: string }; Querystring: { format?: "pdf" | "print" } }>("/api/modules/group-operations/certificates/issues/:id/document", {
    schema: {
      params: { type: "object", required: ["id"], properties: { id: uuid } },
      querystring: { type: "object", additionalProperties: false, properties: { format: { type: "string", enum: ["pdf", "print"] } } },
    },
  }, async (request, reply) => {
    const departmentId = await department(request, reply); if (!departmentId) return reply;
    reply.header("cache-control", "private, no-store");
    const result = await pool!.query<Certificate & { revokedAt: Date | null }>(
      `SELECT issue.id, cert.name, cert.document_text AS "documentText", site.name AS "siteName", g.name AS "groupName",
              concat_ws(' ',person.first_name,person.last_name) AS "personName", issue.issued_at::text AS "issuedAt",
              issue.valid_until::text AS "validUntil", issue.revoked_at AS "revokedAt"
         FROM group_certificate_issues issue
         JOIN group_certificate_definitions cert ON cert.id=issue.certificate_id AND cert.department_id=issue.department_id
         JOIN church_groups g ON g.id=issue.group_id AND g.department_id=issue.department_id
         JOIN contacts person ON person.id=issue.contact_id AND person.department_id=issue.department_id
         JOIN departments site ON site.id=issue.department_id
        WHERE issue.id=$1 AND issue.department_id=$2 AND ${certificateIssueAudience("$3", "$4")}`,
      [request.params.id, departmentId, canManage(request), request.authenticatedUser?.id ?? null],
    );
    const certificate = result.rows[0];
    if (!certificate) return reply.code(404).send({ error: "Certificate not found." });
    if (certificate.revokedAt) return reply.code(410).send({ error: "This certificate has been revoked." });
    if (request.query.format === "print") {
      return reply.header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'")
        .type("text/html; charset=utf-8").send(renderCertificatePrintView(certificate));
    }
    const document = renderCertificatePdf(certificate);
    if (!document) return reply.code(422).send({ error: "Use the print view to save this certificate as a PDF with all its text." });
    return reply.header("content-disposition", 'attachment; filename="group-certificate-' + certificate.id + '.pdf"')
      .type("application/pdf").send(document);
  });


  const certificateTemplateFormat = "smart-church-group-certificate-template";
  app.get<{ Params: { id: string } }>("/api/modules/group-operations/certificates/:id/template", {
    schema: { params: { type: "object", required: ["id"], properties: { id: uuid } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply;
    const { rows: [template] } = await pool!.query<{ name: string; description: string; documentText: string }>(
      `SELECT cert.name,cert.description,cert.document_text AS "documentText"
         FROM group_certificate_definitions cert JOIN church_groups g ON g.id=cert.group_id AND g.department_id=cert.department_id
        WHERE cert.department_id=$1 AND cert.id=$2`, [departmentId, request.params.id]);
    reply.header("cache-control", "private, no-store").header("x-content-type-options", "nosniff");
    if (!template) return reply.code(404).send({ error: "Certificate template not found in this location." });
    return reply.header("content-disposition", 'attachment; filename="group-certificate-template.json"')
      .send({ format: certificateTemplateFormat, version: 1, ...template });
  });

  app.post<{ Body: Record<string, unknown> }>("/api/modules/group-operations/certificates/templates/preview", {
    bodyLimit: 16 * 1024,
    schema: { body: { type: "object" } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true);
    if (!departmentId || !validateMutation(request, reply)) return reply;
    const { format, version, name, description, documentText } = request.body;
    if (format !== certificateTemplateFormat || version !== 1 ||
        Object.keys(request.body).some(key => !["format", "version", "name", "description", "documentText"].includes(key)) ||
        typeof name !== "string" || !name.trim() || name.length > 120 ||
        typeof description !== "string" || description.length > 1000 ||
        typeof documentText !== "string" || documentText.length > 1000 ||
        [name, description, documentText].some(value => value.includes("\u0000"))) {
      return reply.code(400).send({ error: "Choose a valid Smart-Church group certificate template JSON file." });
    }
    if (!validCertificateTemplate(documentText)) {
      return reply.code(400).send({ error: "The template uses a placeholder that Smart-Church does not support." });
    }
    return reply.header("cache-control", "private, no-store")
      .send({ name: name.trim(), description: description.trim(), documentText: documentText.trim() });
  });

  app.post<{ Body: { groupId: string; name: string; description?: string; documentText?: string } }>("/api/modules/group-operations/certificates", {
    schema: { body: { type: "object", additionalProperties: false, required: ["groupId", "name"], properties: { groupId: uuid, name: { type: "string", minLength: 1, maxLength: 120 }, description: { type: "string", maxLength: 1000 }, documentText: { type: "string", maxLength: 1000 } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply; if (!validateMutation(request, reply)) return reply;
    if (!(await existsInLocation("church_groups", request.body.groupId, departmentId))) return reply.code(404).send({ error: "Group not found in this location." });
    const documentText = request.body.documentText?.trim() ?? "";
    if (!validCertificateTemplate(documentText)) return reply.code(400).send({ error: "Use a supported placeholder in the certificate document text." });
    if (!request.body.name.trim()) return reply.code(400).send({ error: "Enter a certificate name." });
    const id = randomUUID();
    await pool!.query("INSERT INTO group_certificate_definitions(id,department_id,group_id,name,description,created_by,document_text) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [id, departmentId, request.body.groupId, request.body.name.trim(), request.body.description?.trim() ?? "", request.authenticatedUser?.id ?? null, documentText]);
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
