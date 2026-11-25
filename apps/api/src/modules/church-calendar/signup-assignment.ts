import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { calendarOccurrenceExists, cleanLocalDateTime, type Recurrence } from "../../calendar-occurrences.js";
import type { ModuleServerContext } from "../module-sdk.js";

type Occurrence = { appointmentId: string; originalStartAt: string };
type CalendarScope = "community" | "group" | "personal";
type Match = { id: string; starts_at: string; recurrence: Recurrence | null; signup_group_id: string | null; scheduled: boolean };
const occurrenceSchema = {
  type: "object", additionalProperties: false, required: ["appointmentId", "originalStartAt"],
  properties: { appointmentId: { type: "string", format: "uuid" }, originalStartAt: { type: "string", minLength: 16, maxLength: 19 } },
} as const;

async function readOccurrence(client: PoolClient, departmentId: string, occurrence: Occurrence) {
  const { rows: [appointment] } = await client.query<Match>(
    `SELECT appointment.id,appointment.recurrence,appointment.signup_group_id,
            to_char(appointment.starts_at,'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at,
            EXISTS (SELECT 1 FROM church_calendar_signup_schedules schedule WHERE schedule.appointment_id=appointment.id) AS scheduled
       FROM church_calendar_appointments appointment
       JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id AND calendar.department_id=appointment.department_id
      WHERE appointment.id=$1 AND appointment.department_id=$2 AND appointment.archived_at IS NULL AND calendar.archived_at IS NULL
        AND calendar.scope='community' AND NOT appointment.internal_only
      FOR UPDATE OF appointment FOR SHARE OF calendar`,
    [occurrence.appointmentId, departmentId],
  );
  if (!appointment) return null;
  const { rows: [exception] } = await client.query<{ cancelled: boolean; overrides: Record<string, unknown> }>(
    "SELECT cancelled,overrides FROM church_calendar_appointment_exceptions WHERE appointment_id=$1 AND original_start=$2::timestamp FOR UPDATE",
    [appointment.id, occurrence.originalStartAt],
  );
  if (exception?.cancelled || exception?.overrides.internalOnly === true) return null;
  if (!calendarOccurrenceExists(appointment, occurrence.originalStartAt)) {
    if (!appointment.recurrence) return null;
    const extra = await client.query("SELECT 1 FROM church_calendar_extra_dates WHERE appointment_id=$1 AND starts_at=$2::timestamp FOR SHARE", [appointment.id, occurrence.originalStartAt]);
    if (!extra.rowCount) return null;
  }
  const overrides = exception?.overrides ?? {};
  const overridden = Object.hasOwn(overrides, "signupGroupId");
  const groupId = overridden ? overrides.signupGroupId : appointment.signup_group_id;
  return { id: appointment.id, scheduled: appointment.scheduled, original: occurrence.originalStartAt,
    useException: Boolean(appointment.recurrence || overridden), inheritedSeriesLink: Boolean(appointment.recurrence && !overridden && groupId),
    groupId };
}

async function saveLink(client: PoolClient, match: NonNullable<Awaited<ReturnType<typeof readOccurrence>>>, groupId: string | null, actorId: string) {
  if (!match.useException) {
    await client.query("UPDATE church_calendar_appointments SET signup_group_id=$2,updated_at=now() WHERE id=$1", [match.id, groupId]);
    return;
  }
  await client.query(
    `INSERT INTO church_calendar_appointment_exceptions(appointment_id,original_start,cancelled,overrides,updated_by)
     VALUES($1,$2::timestamp,false,jsonb_build_object('signupGroupId',$3::text),$4)
     ON CONFLICT(appointment_id,original_start) DO UPDATE SET overrides=church_calendar_appointment_exceptions.overrides || EXCLUDED.overrides,
       updated_by=EXCLUDED.updated_by,updated_at=now()`,
    [match.id, match.original, groupId, actorId],
  );
}

export function registerSignupAssignment(app: FastifyInstance, context: ModuleServerContext,
  canManageCalendar: (request: FastifyRequest, scope: CalendarScope, ownerId: string | null) => boolean) {
  app.patch<{ Params: { id: string }; Body: { appointment: Occurrence; previous?: Occurrence } }>(
    "/api/modules/church-calendar/signup-groups/:id/appointment", { schema: {
      params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["appointment"], properties: { appointment: occurrenceSchema, previous: occurrenceSchema } },
    } }, async (request, reply) => {
      if (!context.pool || !context.isDatabaseReady()) return reply.code(503).send({ error: "Church Calendar is unavailable." });
      if (!context.validateMutation(request, reply)) return reply;
      const departmentId = await context.resolveDepartmentId(request, reply);
      if (!departmentId) return reply;
      if (!canManageCalendar(request, "community", null) || !(request.activeDepartmentRole === "site_admin" || request.activeDepartmentPermissions?.includes("groups_manage"))) {
        return reply.code(403).send({ error: "Calendar and Groups management permissions are required." });
      }
      const groupId = request.params.id.toLowerCase();
      const destination = request.body.appointment;
      const previous = request.body.previous;
      const targetStart = cleanLocalDateTime(destination.originalStartAt);
      const previousStart = previous && cleanLocalDateTime(previous.originalStartAt);
      if (!targetStart || (previous && !previousStart)) {
        return reply.code(400).send({ error: "Use the original Calendar occurrence start in local date-time format." });
      }
      const destinationId = destination.appointmentId.toLowerCase();
      const previousId = previous?.appointmentId.toLowerCase();
      const client = await context.pool.connect();
      const fail = async (code: number, error: string) => {
        await client.query("ROLLBACK");
        return reply.code(code).send({ error });
      };
      try {
        await client.query("BEGIN");
        if (!await context.lockDepartmentForWrite(client, departmentId)) return await fail(423, "This location is read-only.");
        const { rows: [group] } = await client.query<{ signup: boolean; managed: boolean }>(
          `SELECT (groups.public_signup_enabled OR EXISTS (SELECT 1 FROM group_signup_forms form
                              WHERE form.group_id=groups.id AND form.department_id=groups.department_id)) AS signup,
                  EXISTS (SELECT 1 FROM church_calendar_signup_deactivations job WHERE job.group_id=groups.id) AS managed
             FROM church_groups groups WHERE groups.id=$1 AND groups.department_id=$2 AND groups.source_system IS NULL
              AND groups.status IN ('active','draft') FOR UPDATE OF groups`,
          [groupId, departmentId],
        );
        if (!group) return await fail(404, "Registration group not found in this location.");
        const target = await readOccurrence(client, departmentId, { appointmentId: destinationId, originalStartAt: targetStart });
        if (!target) return await fail(404, "Community Calendar occurrence not found.");
        if (previousId === destinationId && previousStart === targetStart && target.groupId !== groupId) return await fail(409, "The previous occurrence no longer uses this group.");
        if (target.groupId === groupId && (!previousId || (target.id === previousId && target.original === previousStart))) {
          await client.query("COMMIT");
          return reply.send({ groupId, appointment: { appointmentId: target.id, originalStartAt: target.original } });
        }
        if (target.groupId) return await fail(409, "The destination occurrence already has a registration group.");
        const source = previousId && previousStart
          ? await readOccurrence(client, departmentId, { appointmentId: previousId, originalStartAt: previousStart }) : null;
        if (previous && (!source || source.groupId !== groupId)) return await fail(409, "The previous occurrence no longer uses this group.");
        if (target.scheduled || source?.scheduled || group.managed || source?.inheritedSeriesLink) {
          return await fail(409, "Review the Calendar registration schedule or series-level link before moving this group.");
        }
        if (!group.signup && !source) return await fail(409, "Configure a signup form for this group before assigning it.");
        if (!source) {
          const existing = await client.query(
            `SELECT 1 FROM church_calendar_appointments appointment WHERE appointment.department_id=$1 AND appointment.archived_at IS NULL
             AND (appointment.signup_group_id=$2 OR EXISTS (
               SELECT 1 FROM church_calendar_appointment_exceptions exception WHERE exception.appointment_id=appointment.id
                 AND NOT exception.cancelled AND exception.overrides->>'signupGroupId'=$2::uuid::text))
             LIMIT 1`, [departmentId, groupId],
          );
          if (existing.rowCount) return await fail(409, "This group is already linked. Specify the previous occurrence to move it.");
        }
        const actorId = request.authenticatedUser!.id;
        if (source) await saveLink(client, source, null, actorId);
        await saveLink(client, target, groupId, actorId);
        await client.query("COMMIT");
        context.realtime.publish("module:church-calendar:changed", departmentId, { action: "registration-group-assigned", appointmentId: target.id });
        context.realtime.publish("core:groups:changed", departmentId, { action: "registration-group-assigned", groupId });
        return reply.send({ groupId, appointment: { appointmentId: target.id, originalStartAt: target.original } });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    });
}
