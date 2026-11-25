import { canonicalTimeZone } from "../../calendar-time.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { calendarBookingWindow, calendarOccurrenceExists, cleanLocalDateTime, localDateTime, wallDate, type Recurrence } from "../../calendar-occurrences.js";
import { isResourceBookingManager } from "../../resource-booking-policy.js";
import { isServerModuleEnabled, type ModuleServerContext } from "../module-sdk.js";

type CalendarScope = "personal" | "community" | "group";
export type CalendarPermission = (request: FastifyRequest, scope: CalendarScope, ownerId: string | null) => boolean;
type DescriptionParams = { id: string; originalStart: string; bookingId: string };
type DescriptionInput = { description: string; expectedRevision: string };

const params = {
  type: "object", additionalProperties: false, required: ["id", "originalStart", "bookingId"], properties: {
    id: { type: "string", format: "uuid" }, bookingId: { type: "string", format: "uuid" }, originalStart: { type: "string", maxLength: 25 },
  },
} as const;
const missing = "This linked reservation is no longer available to edit.";

export async function loadCalendarOccurrence(client: PoolClient, departmentId: string, appointmentId: string, originalStart: string, apply: boolean) {
  const { rows: [appointment] } = await client.query<{ starts_at: string; ends_at: string; all_day: boolean; time_zone: string | null; location_time_zone: string; recurrence: Recurrence | null; scope: CalendarScope; owner_user_id: string | null }>(
    `SELECT to_char(appointment.starts_at,'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at,
            to_char(appointment.ends_at,'YYYY-MM-DD"T"HH24:MI:SS') AS ends_at,
            appointment.all_day,appointment.time_zone,site.time_zone AS location_time_zone,appointment.recurrence,calendar.scope,calendar.owner_user_id
       FROM church_calendar_appointments appointment
       JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id AND calendar.department_id=appointment.department_id
       JOIN departments site ON site.id=appointment.department_id AND 'resource-scheduler'=ANY(site.enabled_modules)
      WHERE appointment.id=$1 AND appointment.department_id=$2 AND appointment.archived_at IS NULL
        AND calendar.archived_at IS NULL AND calendar.scope IN ('community','group')
      ${apply ? "FOR UPDATE OF appointment FOR SHARE OF calendar" : ""}`, [appointmentId, departmentId],
  );
  if (!appointment) return null;
  const { rows: [occurrence] } = await client.query<{
    cancelled: boolean; overrides: Record<string, unknown> | null; extraEnd: string | null;
  }>(
    `SELECT COALESCE(exception.cancelled,false) AS cancelled,exception.overrides,
            to_char(extra.ends_at,'YYYY-MM-DD"T"HH24:MI:SS') AS "extraEnd"
       FROM (SELECT $1::uuid AS id,$2::timestamp AS original) target
       LEFT JOIN church_calendar_appointment_exceptions exception ON exception.appointment_id=target.id AND exception.original_start=target.original
       LEFT JOIN church_calendar_extra_dates extra ON extra.appointment_id=target.id AND extra.starts_at=target.original`,
    [appointmentId, originalStart],
  );
  if (occurrence.cancelled || (!occurrence.extraEnd && !calendarOccurrenceExists(appointment, originalStart))) return null;
  const override = occurrence.overrides ?? {};
  const duration = wallDate(appointment.ends_at).getTime() - wallDate(appointment.starts_at).getTime();
  const start = cleanLocalDateTime(override.startsAt) ?? originalStart;
  const end = cleanLocalDateTime(override.endsAt) ?? occurrence.extraEnd ?? localDateTime(new Date(wallDate(originalStart).getTime() + duration));
  const allDay = (override.allDay ?? appointment.all_day) === true;
  const timeZone = appointment.time_zone ?? canonicalTimeZone(appointment.location_time_zone) ?? "UTC";
  return { ...appointment, window: calendarBookingWindow(start, end, allDay, timeZone) };
}

export function registerCalendarBookingDescriptions(app: FastifyInstance, context: ModuleServerContext, canManageCalendar: CalendarPermission) {
  const url = "/api/modules/church-calendar/appointments/:id/occurrences/:originalStart/resource-bookings/:bookingId/description";
  app.route<{ Params: DescriptionParams; Body: DescriptionInput }>({
    method: ["GET", "PUT"], url,
    schema: { params },
    async handler(request, reply) {
      const pool = context.pool;
      if (!pool || !context.isDatabaseReady()) return reply.code(503).send({ error: "Calendar storage is unavailable." });
      const apply = request.method === "PUT";
      if (apply && !context.validateMutation(request, reply)) return reply;
      const departmentId = await context.resolveDepartmentId(request, reply);
      if (!departmentId) return reply;
      if (!isServerModuleEnabled("resource-scheduler") || !isResourceBookingManager(request)) {
        return reply.code(403).send({ error: "Resource management is required to edit a reservation description." });
      }
      const originalStart = cleanLocalDateTime(request.params.originalStart);
      if (!originalStart) return reply.code(400).send({ error: "Choose a saved Calendar occurrence." });
      if (apply && (typeof request.body?.description !== "string" || request.body.description.length > 2000
        || typeof request.body.expectedRevision !== "string" || request.body.expectedRevision.length !== 27)) {
        return reply.code(400).send({ error: "Provide the current revision and a description of up to 2,000 characters." });
      }
      reply.header("Cache-Control", "private, no-store");
      const { id, bookingId } = request.params;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (apply && !await context.lockDepartmentForWrite(client, departmentId)) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "This location is read-only on this installation." });
        }
        const occurrence = await loadCalendarOccurrence(client, departmentId, id, originalStart, apply);
        if (!occurrence || !canManageCalendar(request, occurrence.scope, occurrence.owner_user_id)) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: missing });
        }
        if (apply) await client.query("SELECT id FROM resource_bookings WHERE id=$1 AND department_id=$2 FOR UPDATE", [bookingId, departmentId]);
        const { rows: [booking] } = await client.query<{ description: string; revision: string }>(
          `SELECT booking.description,to_char(booking.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS revision
             FROM resource_bookings booking
             JOIN church_calendar_resource_links link ON link.resource_booking_id=booking.id
             JOIN bookable_resources resource ON resource.id=booking.resource_id AND resource.department_id=booking.department_id AND resource.active
            WHERE booking.id=$1 AND booking.department_id=$2 AND link.appointment_id=$3 AND link.occurrence_start=$4::timestamp
              AND booking.status IN ('requested','approved') AND booking.ends_at>now() AND NOT booking.is_intake_request
              AND NOT EXISTS (SELECT 1 FROM church_calendar_resource_links other WHERE other.resource_booking_id=booking.id
                AND (other.appointment_id<>link.appointment_id OR other.occurrence_start IS DISTINCT FROM link.occurrence_start))
             ${apply ? "FOR SHARE OF resource" : ""}`,
          [bookingId, departmentId, id, originalStart],
        );
        if (!booking) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: missing });
        }
        if (!apply) {
          await client.query("COMMIT");
          return booking;
        }
        if (request.body.expectedRevision !== booking.revision) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "The reservation changed. Reopen it before saving." });
        }
        const description = request.body.description.trim();
        const changed = description !== booking.description;
        if (changed) {
          await client.query(
            `UPDATE resource_bookings SET description=$3,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond')
              WHERE id=$1 AND department_id=$2`, [bookingId, departmentId, description],
          );
          await client.query(
            `INSERT INTO resource_scheduler_audit(id,department_id,actor_user_id,action,booking_id,details)
             VALUES($1,$2,$3,'booking_details_updated',$4,jsonb_build_object('fields',ARRAY['description'],'scope','calendar-occurrence'))`,
            [randomUUID(), departmentId, request.authenticatedUser!.id, bookingId],
          );
        }
        await client.query("COMMIT");
        if (changed) {
          context.realtime.publish("module:resource-scheduler:changed", departmentId, {});
          context.realtime.publish("module:church-calendar:changed", departmentId, { action: "resource-booking-description-updated" });
        }
        return { updated: changed };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  });
}
