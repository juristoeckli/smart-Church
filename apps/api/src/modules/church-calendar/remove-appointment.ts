import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { calendarOccurrenceExists, cleanLocalDateTime, type Recurrence } from "../../calendar-occurrences.js";
import { truncateCalendarSeries } from "../../calendar-series-split.js";
import { recordResourceBookingDecision } from "../../resource-booking-notices.js";
import { isResourceBookingManager } from "../../resource-booking-policy.js";
import { isServerModuleEnabled, type ModuleServerContext } from "../module-sdk.js";
import type { CalendarPermission } from "./booking-descriptions.js";

type Scope = "occurrence" | "future" | "series";
type Query = { scope?: Scope; occurrenceStartAt?: string; reservationPolicy?: "keep" | "release"; impactRevision?: string };
type Target = {
  starts_at: string; ends_at: string; recurrence: Recurrence | null;
  scope: "community" | "group" | "personal"; owner_user_id: string | null; resources_enabled: boolean;
};
type Candidate = { id: string; status: "requested" | "approved"; revision: string; releasable: boolean };
const params = { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
const queryProperties = {
  scope: { type: "string", enum: ["occurrence", "future", "series"] },
  occurrenceStartAt: { type: "string", maxLength: 25 },
} as const;

async function reservationImpact(client: PoolClient, departmentId: string, appointmentId: string, scope: Scope, boundary: string | null, lock: boolean) {
  const result = await client.query<Candidate>(
    `SELECT booking.id,booking.status,booking.updated_at::text AS revision,
            (link.occurrence_start IS NOT NULL AND NOT COALESCE((to_jsonb(booking)->>'is_intake_request')::boolean,false)
              AND NOT EXISTS (
                SELECT 1 FROM church_calendar_resource_links other WHERE other.resource_booking_id=booking.id
                  AND (other.appointment_id<>link.appointment_id OR other.occurrence_start IS DISTINCT FROM link.occurrence_start)
              )) AS releasable
       FROM church_calendar_resource_links link
       JOIN resource_bookings booking ON booking.id=link.resource_booking_id AND booking.department_id=$1
      WHERE link.appointment_id=$2 AND booking.status IN ('requested','approved') AND booking.ends_at>now()
        AND ($3='series' OR link.occurrence_start IS NULL
          OR ($3='future' AND link.occurrence_start >= $4::timestamp) OR ($3='occurrence' AND link.occurrence_start=$4::timestamp))
      ORDER BY booking.id,link.occurrence_start NULLS FIRST ${lock ? "FOR UPDATE OF booking" : ""}`,
    [departmentId,appointmentId,scope,boundary],
  );
  const candidates = new Map<string,Candidate>();
  for (const row of result.rows) {
    const previous = candidates.get(row.id);
    candidates.set(row.id, previous ? { ...row, releasable: previous.releasable && row.releasable } : row);
  }
  const rows = [...candidates.values()];
  const revision = createHash("sha256").update(JSON.stringify([departmentId,appointmentId,scope,boundary,rows])).digest("hex");
  return { rows, revision };
}

export function registerCalendarRemoval(app: FastifyInstance, context: ModuleServerContext, canManageCalendar: CalendarPermission) {
  app.route<{ Params: { id: string }; Querystring: Query }>({
    method: ["GET","DELETE"],
    url: "/api/modules/church-calendar/appointments/:id",
    schema: { params, querystring: { type: "object", additionalProperties: false, properties: {
      ...queryProperties, reservationPolicy: { type: "string", enum: ["keep","release"] },
      impactRevision: { type: "string", pattern: "^[a-f0-9]{64}$" },
    } } },
    async handler(request, reply) {
      if (!context.pool || !context.isDatabaseReady()) return reply.code(503).send({ error: "Calendar storage is unavailable." });
      const apply = request.method === "DELETE";
      if (apply && !context.validateMutation(request, reply)) return reply;
      const departmentId = await context.resolveDepartmentId(request, reply);
      if (!departmentId) return reply;
      const id = request.params.id;
      const actor = request.authenticatedUser!.id;
      reply.header("Cache-Control", "private, no-store");
      const client = await context.pool.connect();
      try {
        await client.query("BEGIN");
        async function stop(status: number, error: string) {
          await client.query("ROLLBACK");
          return reply.code(status).send({ error });
        }
        if (apply && !await context.lockDepartmentForWrite(client, departmentId)) return await stop(423, "This location is read-only.");
        const { rows: [appointment] } = await client.query<Target>(
          `SELECT to_char(appointment.starts_at,'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at,
                  to_char(appointment.ends_at,'YYYY-MM-DD"T"HH24:MI:SS') AS ends_at,
                  appointment.recurrence,calendar.scope,calendar.owner_user_id,
                  ('resource-scheduler'=ANY(site.enabled_modules)
                    AND to_regclass('public.resource_scheduler_audit') IS NOT NULL) AS resources_enabled
             FROM church_calendar_appointments appointment
             JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id AND calendar.department_id=appointment.department_id
             JOIN departments site ON site.id=appointment.department_id
            WHERE appointment.id=$1 AND appointment.department_id=$2 AND appointment.archived_at IS NULL AND calendar.archived_at IS NULL
            ${apply ? "FOR UPDATE OF appointment FOR SHARE OF calendar" : ""}`,
          [id,departmentId],
        );
        if (!appointment) return await stop(404, "The appointment was not found.");
        if (!canManageCalendar(request, appointment.scope, appointment.owner_user_id)) return await stop(403, "You do not have permission to remove this appointment.");
        const scope = appointment.recurrence ? request.query.scope ?? "series" : "series";
        const boundary = scope === "series" ? null : cleanLocalDateTime(request.query.occurrenceStartAt);
        if (scope !== "series" && !boundary) return await stop(400, "Choose which occurrence to remove.");
        if (boundary && appointment.recurrence) {
          const { rows: [state] } = await client.query<{ extra: boolean; cancelled: boolean }>(
            `SELECT EXISTS (SELECT 1 FROM church_calendar_extra_dates WHERE appointment_id=$1 AND starts_at=$2::timestamp) AS extra,
                    EXISTS (SELECT 1 FROM church_calendar_appointment_exceptions WHERE appointment_id=$1 AND original_start=$2::timestamp AND cancelled) AS cancelled`,
            [id,boundary],
          );
          if (state.cancelled || !(state.extra || calendarOccurrenceExists(appointment, boundary))) {
            return await stop(409, "Choose an existing occurrence to remove.");
          }
        }
        const canRelease = appointment.resources_enabled && isServerModuleEnabled("resource-scheduler") && isResourceBookingManager(request);
        const release = request.query.reservationPolicy === "release";
        if (apply && release && !canRelease) return await stop(403, "Resource management access is required to release these reservations.");
        const impact = canRelease ? await reservationImpact(client, departmentId, id, scope, boundary, apply && release) : null;
        const eligible = impact?.rows.filter((booking) => booking.releasable) ?? [];
        if (!apply) {
          await client.query("COMMIT");
          const pending = eligible.filter((booking) => booking.status === "requested").length;
          return {
            scope, canRelease, confirmed: eligible.length - pending, pending,
            protectedCount: (impact?.rows.length ?? 0) - eligible.length,
            ...(impact ? { revision: impact.revision } : {}),
          };
        }
        if (release && (!impact || request.query.impactRevision !== impact.revision || !eligible.length)) {
          return await stop(409, "The affected reservations changed. Review the removal again.");
        }
        for (const booking of release ? eligible : []) {
          await client.query(
            `UPDATE resource_bookings SET status='cancelled',updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond')
              WHERE id=$1 AND department_id=$2`, [booking.id,departmentId],
          );
          await client.query(
            `INSERT INTO resource_scheduler_audit(id,department_id,actor_user_id,action,booking_id,details)
             VALUES($1,$2,$3,'booking_cancelled',$4,jsonb_build_object('status','cancelled','previousStatus',$5::text,'scope','calendar-removal','removalScope',$6::text))`,
            [randomUUID(),departmentId,actor,booking.id,booking.status,scope],
          );
          await recordResourceBookingDecision(client, departmentId, booking.id, actor, "cancelled");
        }
        if (scope === "occurrence") {
          await client.query(
            `INSERT INTO church_calendar_appointment_exceptions(appointment_id,original_start,cancelled,overrides,updated_by)
             VALUES($1,$2::timestamp,true,'{}',$3)
             ON CONFLICT(appointment_id,original_start) DO UPDATE SET cancelled=true,overrides='{}',updated_by=EXCLUDED.updated_by,updated_at=now()`,
            [id,boundary,actor],
          );
        } else if (scope === "future" && appointment.recurrence && boundary) {
          const previous = truncateCalendarSeries({ ...appointment, recurrence: appointment.recurrence }, boundary);
          await client.query("UPDATE church_calendar_appointments SET recurrence=$2::jsonb,updated_at=now() WHERE id=$1", [id,JSON.stringify(previous)]);
          await client.query("DELETE FROM church_calendar_meeting_requests WHERE appointment_id=$1 AND original_start >= $2::timestamp", [id,boundary]);
          await client.query("DELETE FROM church_calendar_extra_dates WHERE appointment_id=$1 AND starts_at >= $2::timestamp", [id,boundary]);
          await client.query("DELETE FROM church_calendar_appointment_exceptions WHERE appointment_id=$1 AND original_start >= $2::timestamp", [id,boundary]);
          // Keep reservation provenance while hiding the removed occurrences from Calendar links.
          await client.query(
            `INSERT INTO church_calendar_appointment_exceptions(appointment_id,original_start,cancelled,overrides,updated_by)
             SELECT DISTINCT appointment_id,occurrence_start,true,'{}'::jsonb,$3::uuid FROM church_calendar_resource_links
              WHERE appointment_id=$1 AND occurrence_start >= $2::timestamp`, [id,boundary,actor],
          );
          await client.query("DELETE FROM church_calendar_reminders WHERE appointment_id=$1 AND original_start >= $2::timestamp AND delivered_at IS NULL", [id,boundary]);
        } else {
          await client.query("UPDATE church_calendar_appointments SET archived_at=now(),updated_at=now() WHERE id=$1 AND department_id=$2", [id,departmentId]);
        }
        await client.query("COMMIT");
        const released = release ? eligible.length : 0;
        if (released) context.realtime.publish("module:resource-scheduler:changed", departmentId, {});
        context.realtime.publish("module:church-calendar:changed", departmentId, { action: "appointment-removed", appointmentId: id, scope });
        return { deleted: true, released };
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
  });
}
