import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { calendarBookingWindow, calendarOccurrenceExists, cleanLocalDateTime, localDateTime, wallDate, type Recurrence } from "../../calendar-occurrences.js";
import { canonicalTimeZone } from "../../calendar-time.js";
import { isServerModuleEnabled, type ModuleServerContext } from "../module-sdk.js";

type ResponseStatus = "accepted" | "declined";
type CalendarPermission = (request: FastifyRequest, scope: "group", ownerId: null) => boolean;
type AppointmentRow = {
  group_id: string; starts_at: string; ends_at: string; all_day: boolean;
  recurrence: Recurrence | null; time_zone: string | null; location_time_zone: string;
};
type Membership = { userId: string; name: string };

async function currentOccurrence(client: PoolClient, departmentId: string, appointmentId: string, originalStart: string) {
  const { rows: [appointment] } = await client.query<AppointmentRow>(
    `SELECT calendar.group_id,appointment.recurrence,appointment.all_day,appointment.time_zone,department.time_zone AS location_time_zone,
            to_char(appointment.starts_at,'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at,
            to_char(appointment.ends_at,'YYYY-MM-DD"T"HH24:MI:SS') AS ends_at
       FROM church_calendar_appointments appointment
       JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id AND calendar.department_id=appointment.department_id
       JOIN departments department ON department.id=appointment.department_id
       JOIN church_groups church_group ON church_group.id=calendar.group_id AND church_group.department_id=calendar.department_id
      WHERE appointment.id=$1 AND appointment.department_id=$2 AND appointment.archived_at IS NULL
        AND calendar.scope='group' AND calendar.archived_at IS NULL AND church_group.status='active'
      FOR UPDATE OF appointment FOR SHARE OF calendar,church_group`, [appointmentId, departmentId],
  );
  if (!appointment) return null;
  const { rows: [exception] } = await client.query<{ cancelled: boolean; overrides: Record<string, unknown> }>(
    "SELECT cancelled,overrides FROM church_calendar_appointment_exceptions WHERE appointment_id=$1 AND original_start=$2::timestamp",
    [appointmentId, originalStart],
  );
  if (exception?.cancelled) return null;
  const { rows: [extra] } = await client.query<{ endAt: string }>(
    `SELECT to_char(ends_at,'YYYY-MM-DD"T"HH24:MI:SS') AS "endAt" FROM church_calendar_extra_dates WHERE appointment_id=$1 AND starts_at=$2::timestamp`,
    [appointmentId, originalStart],
  );
  if (!extra && !calendarOccurrenceExists(appointment, originalStart)) return null;
  const duration = +wallDate(appointment.ends_at) - +wallDate(appointment.starts_at);
  const startsAt = cleanLocalDateTime(exception?.overrides.startsAt) ?? originalStart;
  const endsAt = cleanLocalDateTime(exception?.overrides.endsAt) ?? extra?.endAt ?? localDateTime(new Date(+wallDate(originalStart) + duration));
  const allDay = (exception?.overrides.allDay ?? appointment.all_day) === true;
  const zone = canonicalTimeZone(appointment.time_zone ?? appointment.location_time_zone);
  const window = zone && calendarBookingWindow(startsAt, endsAt, allDay, zone);
  if (!window || Date.parse(window.endsAtUtc) <= Date.now() || Date.parse(window.startsAtUtc) >= Date.parse(window.endsAtUtc)) return null;
  return { groupId: appointment.group_id, startsAt: window.startsAtUtc, endsAt: window.endsAtUtc };
}

async function eligibleMembers(client: PoolClient, departmentId: string, groupId: string, userIds: string[] | null) {
  const result = await client.query<Membership>(
    `SELECT account.id AS "userId",account.display_name AS name
       FROM department_memberships membership
       JOIN app_users account ON account.id=membership.user_id AND account.is_enabled AND NOT account.is_service_user
       JOIN contacts contact ON contact.id=membership.contact_id AND contact.department_id=membership.department_id AND contact.archived_at IS NULL
       JOIN group_members member ON member.group_id=$2 AND member.contact_id=contact.id AND member.status='active'
      WHERE membership.department_id=$1 AND ($3::uuid[] IS NULL OR account.id=ANY($3::uuid[]))
      ORDER BY account.display_name,account.id LIMIT 501
      FOR SHARE OF membership,account,contact,member`, [departmentId, groupId, userIds],
  );
  return result.rows;
}

async function queueInvitationNotices(client: PoolClient, departmentId: string, actor: string, invited: Array<{ recipient_user_id: string; notice_id: string }>) {
  if (!invited.length || !isServerModuleEnabled("notifications")) return;
  const storage = await client.query<{ ready: boolean }>("SELECT to_regclass('public.module_notifications') IS NOT NULL AS ready");
  if (!storage.rows[0]?.ready) return;
  await client.query(
    `INSERT INTO module_notifications(id,department_id,recipient_user_id,sender_user_id,kind,title,body,in_app_enabled,email_enabled)
     SELECT notice_id,$1,recipient_user_id,$2,'calendar_meeting_request','Calendar meeting request',
            'You have a meeting invitation. Open the group appointment in Calendar to respond.',true,true
       FROM jsonb_to_recordset($3::jsonb) recipients(recipient_user_id uuid,notice_id uuid) WHERE recipient_user_id<>$2`, [departmentId, actor, JSON.stringify(invited)],
  );
}

export function registerCalendarMeetingRequests(app: FastifyInstance, context: ModuleServerContext, canManageCalendar: CalendarPermission) {
  app.route<{
    Params: { id: string; originalStart: string };
    Body?: { recipientIds?: string[]; status?: ResponseStatus; window?: string };
  }>({
    method: ["GET", "POST", "PUT"],
    url: "/api/modules/church-calendar/appointments/:id/occurrences/:originalStart/meeting-requests",
    schema: { params: { type: "object", required: ["id", "originalStart"], properties: {
      id: { type: "string", format: "uuid" }, originalStart: { type: "string", maxLength: 25 },
    } } },
    async handler(request, reply) {
      const pool = context.pool;
      if (!pool || !context.isDatabaseReady()) return reply.code(503).send({ error: "Calendar storage is unavailable." });
      if (request.method !== "GET" && !context.validateMutation(request, reply)) return reply;
      const departmentId = await context.resolveDepartmentId(request, reply);
      if (!departmentId) return reply;
      const original = cleanLocalDateTime(request.params.originalStart);
      if (!original) return reply.code(400).send({ error: "Choose a saved occurrence." });
      const actor = request.authenticatedUser!.id;
      const manager = canManageCalendar(request, "group", null);
      const rawRecipients = request.body?.recipientIds;
      const status = request.body?.status;
      if (request.method === "POST" && !manager) return reply.code(403).send({ error: "Calendar management is required to invite members." });
      if (request.method === "POST" && (!Array.isArray(rawRecipients) || rawRecipients.length < 1 || rawRecipients.length > 100 ||
        rawRecipients.some((value) => typeof value !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)))) {
        return reply.code(400).send({ error: "Select up to 100 members to invite." });
      }
      if (request.method === "PUT" && status !== "accepted" && status !== "declined") {
        return reply.code(400).send({ error: "Choose Accept or Decline." });
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (request.method !== "GET" && !await context.lockDepartmentForWrite(client, departmentId)) {
          await client.query("ROLLBACK");
          return reply.code(423).send({ error: "This location is read-only." });
        }
        const occurrence = await currentOccurrence(client, departmentId, request.params.id, original);
        if (!occurrence) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "This group appointment occurrence is unavailable." });
        }
        const window = occurrence.startsAt + "/" + occurrence.endsAt;
        if (request.method !== "GET" && request.body?.window !== window) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "The occurrence changed. Review the current appointment and try again." });
        }
        const recipientIds = [...new Set(request.method === "POST" ? rawRecipients!.map((id) => id.toLowerCase()) : [])];
        const members = await eligibleMembers(client, departmentId, occurrence.groupId,
          request.method === "POST" ? recipientIds : request.method === "PUT" || !manager ? [actor] : null);
        const windowKey = [request.params.id, original, occurrence.startsAt, occurrence.endsAt] as const;
        if (request.method === "POST") {
          if (members.length !== recipientIds.length) {
            await client.query("ROLLBACK");
            return reply.code(400).send({ error: "Choose current members with active accounts in this location." });
          }
          const result = await client.query<{ recipient_user_id: string; notice_id: string }>(
            `INSERT INTO church_calendar_meeting_requests(appointment_id,original_start,scheduled_start,scheduled_end,recipient_user_id,invited_by)
             SELECT $1,$2::timestamp,$3::timestamptz,$4::timestamptz,recipient,$6 FROM unnest($5::uuid[]) recipients(recipient)
             ON CONFLICT(appointment_id,original_start,recipient_user_id) DO UPDATE
               SET scheduled_start=EXCLUDED.scheduled_start,scheduled_end=EXCLUDED.scheduled_end,invited_by=EXCLUDED.invited_by,
                   invited_at=now(),notice_id=EXCLUDED.notice_id,status='pending',responded_at=NULL
               WHERE (church_calendar_meeting_requests.scheduled_start,church_calendar_meeting_requests.scheduled_end)
                 IS DISTINCT FROM (EXCLUDED.scheduled_start,EXCLUDED.scheduled_end)
             RETURNING recipient_user_id,notice_id`, [...windowKey, recipientIds, actor],
          );
          await queueInvitationNotices(client, departmentId, actor, result.rows);
          await client.query("COMMIT");
          if (result.rows.length) context.realtime.publish("module:church-calendar:changed", departmentId, { action: "meeting-requests-changed" });
          return reply.code(201).send({ invited: result.rows.length });
        }
        const eligible = members.some((member) => member.userId === actor);
        if (!eligible && (!manager || request.method === "PUT")) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "This group appointment occurrence is unavailable." });
        }
        if (request.method === "PUT") {
          const result = await client.query(
            `UPDATE church_calendar_meeting_requests SET status=$6,responded_at=CASE WHEN status=$6 THEN responded_at ELSE now() END
              WHERE appointment_id=$1 AND original_start=$2::timestamp AND scheduled_start=$3::timestamptz
                AND scheduled_end=$4::timestamptz AND recipient_user_id=$5 RETURNING status`, [...windowKey, actor, status],
          );
          await client.query("COMMIT");
          if (result.rowCount) context.realtime.publish("module:church-calendar:changed", departmentId, { action: "meeting-requests-changed" });
          return result.rowCount ? { status } : reply.code(404).send({ error: "No invitation is available for this occurrence." });
        }
        const roster = await client.query<{ userId: string; status: "pending" | ResponseStatus }>(
          `SELECT recipient_user_id AS "userId",status FROM church_calendar_meeting_requests
            WHERE appointment_id=$1 AND original_start=$2::timestamp AND scheduled_start=$3::timestamptz
              AND scheduled_end=$4::timestamptz AND recipient_user_id=ANY($5::uuid[])`, [...windowKey, members.map((member) => member.userId)],
        );
        const byUser = new Map(roster.rows.map((row) => [row.userId, row.status]));
        await client.query("COMMIT");
        return {
          window, myStatus: byUser.get(actor) ?? null,
          ...(manager ? { members: members.slice(0, 500).map((member) => ({ ...member, status: byUser.get(member.userId) ?? null })), truncated: members.length > 500 } : {}),
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  });
}

type ActiveRequestStatus = "pending" | ResponseStatus;
type OccurrenceRequests = {
  appointmentId: string; originalStart: string; startsAt: Date; endsAt: Date; myStatus: ActiveRequestStatus | null;
};

export function occurrenceRequestKey(id: string, originalStart: string, startsAt: string | Date, endsAt: string | Date) {
  return `${id}:${originalStart}:${new Date(startsAt).getTime()}:${new Date(endsAt).getTime()}`;
}

export async function loadOccurrenceRequestScope(
  db: Pick<PoolClient, "query">, departmentId: string, viewerId: string, appointmentIds: string[], from: string, to: string,
) {
  if (!appointmentIds.length) return new Map<string, ActiveRequestStatus | null>();
  // Bound the search by the displayed range plus time-zone offset in either direction.
  const start = new Date(Date.parse(from + "Z") - 2 * 86_400_000);
  const end = new Date(Date.parse(to + "Z") + 2 * 86_400_000);
  const result = await db.query<OccurrenceRequests>(
    `SELECT invitation.appointment_id AS "appointmentId",
            to_char(invitation.original_start,'YYYY-MM-DD"T"HH24:MI:SS') AS "originalStart",
            invitation.scheduled_start AS "startsAt",invitation.scheduled_end AS "endsAt",
            max(invitation.status) FILTER (WHERE invitation.recipient_user_id=$2) AS "myStatus"
       FROM church_calendar_meeting_requests invitation
       JOIN church_calendar_appointments appointment ON appointment.id=invitation.appointment_id AND appointment.department_id=$1
       JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id AND calendar.department_id=$1
       JOIN church_groups church_group ON church_group.id=calendar.group_id AND church_group.department_id=$1 AND church_group.status='active'
       JOIN department_memberships membership ON membership.department_id=$1 AND membership.user_id=invitation.recipient_user_id
       JOIN app_users account ON account.id=membership.user_id AND account.is_enabled AND NOT account.is_service_user
       JOIN contacts contact ON contact.id=membership.contact_id AND contact.department_id=$1 AND contact.archived_at IS NULL
       JOIN group_members member ON member.group_id=calendar.group_id AND member.contact_id=contact.id AND member.status='active'
      WHERE invitation.appointment_id=ANY($3::uuid[]) AND appointment.archived_at IS NULL AND calendar.archived_at IS NULL
        AND calendar.scope='group' AND invitation.scheduled_end>now()
        AND invitation.scheduled_start<=$5 AND invitation.scheduled_end>=$4
      GROUP BY invitation.appointment_id,invitation.original_start,invitation.scheduled_start,invitation.scheduled_end`,
    [departmentId, viewerId, appointmentIds, start, end],
  );
  return new Map(result.rows.map(({ appointmentId, originalStart, startsAt, endsAt, myStatus }) => [
    occurrenceRequestKey(appointmentId, originalStart, startsAt, endsAt), myStatus,
  ]));
}
