import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { calendarOccurrenceExists, cleanLocalDateTime, type Recurrence } from "../../calendar-occurrences.js";
import { isServerModuleEnabled, type ModuleServerContext } from "../module-sdk.js";

const root = "/api/modules/church-calendar/appointments/:appointmentId/check-in/:originalStart";
const uuid = { type: "string", format: "uuid" } as const;
const occurrenceProperties = {
  appointmentId: uuid,
  originalStart: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$" },
} as const;
const statuses = ["absent", "excused", "present"] as const;
type Status = typeof statuses[number];
type Params = { appointmentId: string; originalStart: string };
type MemberParams = Params & { groupId: string; contactId: string };
type Group = { id: string; name: string };
type Meeting = { id: string; groupId: string; completedAt: Date | null };
type RosterMember = { groupId: string; contactId: string; firstName: string; lastName: string; role: string | null; status: Status };

async function loadAppointment(database: Pick<PoolClient, "query">, departmentId: string, params: Params, lock = false) {
  const original = cleanLocalDateTime(params.originalStart);
  if (!original || original !== params.originalStart) return null;
  const { rows: [appointment] } = await database.query<{ title: string; starts_at: string; recurrence: Recurrence | null }>(
    `SELECT a.title,a.recurrence,to_char(a.starts_at,'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at
       FROM church_calendar_appointments a
       JOIN church_calendar_calendars calendar ON calendar.id=a.calendar_id AND calendar.department_id=a.department_id
       JOIN departments site ON site.id=a.department_id AND 'check-in'=ANY(site.enabled_modules)
      WHERE a.department_id=$1 AND a.id=$2 AND a.archived_at IS NULL AND calendar.archived_at IS NULL
        AND (calendar.scope='community' OR (calendar.scope='group' AND EXISTS(
          SELECT 1 FROM church_groups owner WHERE owner.id=calendar.group_id
            AND owner.department_id=$1 AND owner.status='active' AND owner.source_system IS NULL
        )))` + (lock ? " FOR UPDATE OF a FOR SHARE OF calendar" : ""), [departmentId, params.appointmentId],
  );
  if (!appointment) return null;
  const { rows: [exception] } = await database.query<{ cancelled: boolean; overrides: Record<string, unknown> | null; extra: boolean }>(
    `SELECT COALESCE(ex.cancelled,false) AS cancelled,ex.overrides,extra.starts_at IS NOT NULL AS extra
       FROM (SELECT $1::uuid AS id,$2::timestamp AS starts_at) occurrence
       LEFT JOIN church_calendar_appointment_exceptions ex ON ex.appointment_id=occurrence.id AND ex.original_start=occurrence.starts_at
       LEFT JOIN church_calendar_extra_dates extra ON extra.appointment_id=occurrence.id AND extra.starts_at=occurrence.starts_at`,
    [params.appointmentId, original],
  );
  const regular = calendarOccurrenceExists(appointment, original);
  if (exception.cancelled || (!regular && !exception.extra)) return null;
  const start = cleanLocalDateTime(exception.overrides?.startsAt) ?? original;
  const rawTitle = exception.overrides?.title ?? appointment.title;
  const title = typeof rawTitle === "string" ? Array.from(rawTitle).slice(0, 160).join("") : "";
  return { date: start.slice(0, 10), title, key: !appointment.recurrence && regular ? "single" : original };
}

export function registerCalendarGroupAttendance(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation, realtime } = context;
  async function scope(request: FastifyRequest, reply: FastifyReply, write = false) {
    reply.header("Cache-Control", "private, no-store");
    if (!pool || !isDatabaseReady()) {
      reply.code(503).send({ error: "Calendar check-in is unavailable while the database is offline." });
      return null;
    }
    if (!isServerModuleEnabled("check-in")) {
      reply.code(404).send({ error: "Check-in is unavailable." });
      return null;
    }
    const departmentId = await resolveDepartmentId(request, reply, false, false, "groups_manage");
    if (!departmentId || (write && !validateMutation(request, reply))) return null;
    return departmentId;
  }

  app.get<{ Params: Params; Querystring: { groups: string } }>(root, { schema: {
    params: { type: "object", required: ["appointmentId", "originalStart"], properties: occurrenceProperties },
    querystring: { type: "object", additionalProperties: false, required: ["groups"], properties: {
      groups: { type: "string", minLength: 36, maxLength: 924 },
    } },
  } }, async (request, reply) => {
    const departmentId = await scope(request, reply);
    if (!departmentId) return reply;
    const groupIds = [...new Set(request.query.groups.split(",").map(id => id.toLowerCase()))];
    if (groupIds.some(id => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))) {
      return reply.code(400).send({ error: "Choose valid groups for the roster." });
    }
    const appointment = await loadAppointment(pool!, departmentId, request.params);
    if (!appointment) return reply.code(404).send({ error: "This calendar occurrence is unavailable." });
    const groups = await pool!.query<Group>(
      "SELECT id,name FROM church_groups WHERE department_id=$1 AND id=ANY($2::uuid[]) AND status='active' AND source_system IS NULL ORDER BY lower(name),id",
      [departmentId, groupIds],
    );
    if (groups.rows.length !== groupIds.length) return reply.code(404).send({ error: "One or more groups are unavailable at this location." });
    const meetings = await pool!.query<Meeting>(
      `SELECT id,group_id AS "groupId",attendance_completed_at AS "completedAt"
       FROM group_meetings WHERE department_id=$1 AND group_id=ANY($2::uuid[]) AND calendar_appointment_id=$3 AND calendar_occurrence_key=$4`,
      [departmentId, groupIds, request.params.appointmentId, appointment.key],
    );
    const roster = await pool!.query<RosterMember>(
      `SELECT roster.group_id AS "groupId",p.id AS "contactId",p.first_name AS "firstName",p.last_name AS "lastName",roster.role,roster.status
         FROM (
           SELECT m.group_id,m.contact_id,m.role,'absent'::text AS status FROM group_members m
            WHERE m.group_id=ANY($2::uuid[]) AND m.status='active' AND m.group_id<>ALL($3::uuid[])
           UNION ALL
           SELECT meetings.group_id,a.contact_id,member.role,a.status FROM group_meeting_attendance a
             JOIN group_meetings meetings ON meetings.id=a.meeting_id AND meetings.department_id=$1
             LEFT JOIN group_members member ON member.group_id=meetings.group_id AND member.contact_id=a.contact_id
            WHERE a.meeting_id=ANY($4::uuid[])
         ) roster
         JOIN contacts p ON p.id=roster.contact_id AND p.department_id=$1 AND p.archived_at IS NULL
        ORDER BY lower(p.last_name),lower(p.first_name),p.id,roster.group_id`,
      [departmentId, groupIds, meetings.rows.map(meeting => meeting.groupId), meetings.rows.map(meeting => meeting.id)],
    );
    return { groups: groups.rows, meetings: meetings.rows, attendees: roster.rows };
  });

  app.put<{ Params: MemberParams; Body: { present: boolean; expectedStatus: Status } }>(root + "/groups/:groupId/attendees/:contactId", { schema: {
    params: { type: "object", required: ["appointmentId", "originalStart", "groupId", "contactId"],
      properties: { ...occurrenceProperties, groupId: uuid, contactId: uuid } },
    body: { type: "object", additionalProperties: false, required: ["present", "expectedStatus"], properties: {
      present: { type: "boolean" }, expectedStatus: { type: "string", enum: statuses },
    } },
  } }, async (request, reply) => {
    const departmentId = await scope(request, reply, true);
    if (!departmentId) return reply;
    let saved: { meetingId: string; status: Status } | undefined;
    const { groupId, contactId, appointmentId } = request.params;
    const { present, expectedStatus } = request.body;
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) return reply.code(423).send({ error: "This location is read-only." });
      const appointment = await loadAppointment(client, departmentId, request.params, true);
      if (!appointment) return reply.code(404).send({ error: "This calendar occurrence is unavailable." });
      const group = await client.query(
        "SELECT id FROM church_groups WHERE department_id=$1 AND id=$2 AND status='active' AND source_system IS NULL FOR UPDATE",
        [departmentId, groupId],
      );
      if (!group.rowCount) return reply.code(404).send({ error: "This group is unavailable at this location." });
      const { rows: [existing] } = await client.query<{ id: string; completed: boolean }>(
        `SELECT id,attendance_completed_at IS NOT NULL AS completed FROM group_meetings
          WHERE department_id=$1 AND group_id=$2 AND calendar_appointment_id=$3 AND calendar_occurrence_key=$4 FOR UPDATE`,
        [departmentId, groupId, appointmentId, appointment.key],
      );
      if (existing?.completed) return reply.code(409).send({ error: "Attendance for this group meeting is completed." });
      const eligible = await client.query(
        "SELECT id FROM contacts WHERE department_id=$1 AND id=$2 AND archived_at IS NULL FOR SHARE", [departmentId, contactId],
      );
      if (!eligible.rowCount) return reply.code(404).send({ error: "This person is unavailable on the group roster." });
      if (!existing) {
        const member = await client.query(
          "SELECT 1 FROM group_members WHERE group_id=$1 AND contact_id=$2 AND status='active' FOR SHARE", [groupId, contactId],
        );
        if (!member.rowCount) return reply.code(404).send({ error: "This person is unavailable on the group roster." });
        if (!present || expectedStatus !== "absent") return reply.code(409).send({ error: "Refresh the roster before changing attendance." });
      }
      const meetingId = existing?.id ?? randomUUID();
      if (!existing) {
        await client.query(
          `INSERT INTO group_meetings(id,department_id,group_id,meeting_date,title,calendar_appointment_id,calendar_occurrence_key)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [meetingId, departmentId, groupId, appointment.date, appointment.title, appointmentId, appointment.key],
        );
        await client.query(
          `INSERT INTO group_meeting_attendance(meeting_id,contact_id)
           SELECT $1,m.contact_id FROM group_members m
             JOIN contacts c ON c.id=m.contact_id AND c.department_id=$2 AND c.archived_at IS NULL
            WHERE m.group_id=$3 AND m.status='active'`, [meetingId, departmentId, groupId],
        );
      }
      const status = present ? "present" : "absent";
      const updated = await client.query(
        `UPDATE group_meeting_attendance SET status=$3,updated_at=now()
          WHERE meeting_id=$1 AND contact_id=$2 AND status=$4`, [meetingId, contactId, status, expectedStatus],
      );
      if (!updated.rowCount) return reply.code(409).send({ error: "The group roster changed. Refresh and try again." });
      await client.query("COMMIT");
      saved = { meetingId, status };
    } finally {
      try { if (!saved) await client.query("ROLLBACK"); }
      finally { client.release(); }
    }
    realtime.publish("core:groups:changed", departmentId, { groupId, meetingId: saved.meetingId, action: "meeting-attendance-updated" });
    return saved;
  });
}
