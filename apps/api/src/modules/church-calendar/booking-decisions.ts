import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { cleanLocalDateTime } from "../../calendar-occurrences.js";
import { recordResourceBookingDecision } from "../../resource-booking-notices.js";
import { isResourceBookingManager, lockResourceBookingKey } from "../../resource-booking-policy.js";
import { isServerModuleEnabled, type ModuleServerContext } from "../module-sdk.js";
import { loadCalendarOccurrence, type CalendarPermission } from "./booking-descriptions.js";

type OpenStatus = "requested" | "approved";
type Decision = "approved" | "declined" | "cancelled";
type Params = { id: string; originalStart: string; bookingId: string };
type Body = { expectedStatus: OpenStatus; status: Decision };

export function registerCalendarBookingDecisions(app: FastifyInstance, context: ModuleServerContext, canManageCalendar: CalendarPermission) {
  app.put<{ Params: Params; Body: Body }>("/api/modules/church-calendar/appointments/:id/occurrences/:originalStart/resource-bookings/:bookingId/status", {
    schema: {
      params: {
        type: "object", additionalProperties: false, required: ["id", "originalStart", "bookingId"],
        properties: { id: { type: "string", format: "uuid" }, bookingId: { type: "string", format: "uuid" }, originalStart: { type: "string", maxLength: 25 } },
      },
      body: {
        type: "object", additionalProperties: false, required: ["status", "expectedStatus"],
        properties: { status: { enum: ["approved", "declined", "cancelled"] }, expectedStatus: { enum: ["requested", "approved"] } },
      },
    },
  }, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return reply.code(503).send({ error: "Calendar storage is unavailable." });
    if (!context.validateMutation(request, reply)) return reply;
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    if (!isServerModuleEnabled("resource-scheduler") || !isResourceBookingManager(request)) {
      return reply.code(403).send({ error: "Resource management access is required to change reservation status." });
    }
    const { id, bookingId } = request.params;
    const original = cleanLocalDateTime(request.params.originalStart);
    if (!original) return reply.code(400).send({ error: "Choose a valid saved Calendar occurrence." });
    const { status, expectedStatus } = request.body;
    if (status !== "cancelled" && expectedStatus !== "requested") {
      return reply.code(400).send({ error: "Only a pending resource request can be approved or declined." });
    }
    reply.header("Cache-Control", "private, no-store");
    const client = await context.pool.connect();
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "This location is read-only on this installation." });
      }
      const appointment = await loadCalendarOccurrence(client, departmentId, id, original, true);
      if (!appointment || !canManageCalendar(request, appointment.scope, appointment.owner_user_id)) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "The linked reservation is not available for this occurrence." });
      }
      // Serialize decisions and other edits before checking exact linkage.
      const { rows: [locked] } = await client.query<{ resource_id: string }>(
        "SELECT resource_id FROM resource_bookings WHERE id=$1 AND department_id=$2 FOR UPDATE", [bookingId, departmentId],
      );
      if (locked) await lockResourceBookingKey(client, departmentId, locked.resource_id);
      const { rows: [booking] } = await client.query<{
        status: string; starts_at: Date; ends_at: Date; active: boolean; in_future: boolean;
      }>(
        `SELECT booking.status,booking.starts_at,booking.ends_at,resource.active,booking.ends_at>now() AS in_future
           FROM resource_bookings booking
           JOIN church_calendar_resource_links link ON link.resource_booking_id=booking.id
           JOIN bookable_resources resource ON resource.id=booking.resource_id AND resource.department_id=booking.department_id
          WHERE booking.id=$1 AND booking.department_id=$2 AND link.appointment_id=$3 AND link.occurrence_start=$4::timestamp
            AND NOT booking.is_intake_request
            AND NOT EXISTS (SELECT 1 FROM church_calendar_resource_links other WHERE other.resource_booking_id=booking.id
              AND (other.appointment_id<>link.appointment_id OR other.occurrence_start IS DISTINCT FROM link.occurrence_start))
          FOR SHARE OF resource`, [bookingId, departmentId, id, original],
      );
      if (!booking) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "The linked reservation is not available for this occurrence." });
      }
      if (booking.status !== expectedStatus || !booking.in_future) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "The reservation status changed or its booking window ended. Refresh Calendar." });
      }
      if (status === "approved" && (!booking.active || !appointment.window
        || booking.starts_at.getTime() !== Date.parse(appointment.window.startsAtUtc)
        || booking.ends_at.getTime() !== Date.parse(appointment.window.endsAtUtc))) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "The reservation time no longer matches this occurrence or the resource is inactive. Review the booking before approving." });
      }
      await client.query(
        `UPDATE resource_bookings SET status=$3,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond')
          WHERE id=$1 AND department_id=$2`, [bookingId, departmentId, status],
      );
      const actor = request.authenticatedUser!.id;
      await client.query(
        `INSERT INTO resource_scheduler_audit(id,department_id,actor_user_id,action,booking_id,details)
         VALUES($1,$2,$3,$4,$5,jsonb_build_object('status',$6::text,'previousStatus',$7::text,'scope','calendar-occurrence'))`,
        [randomUUID(), departmentId, actor, "booking_" + status, bookingId, status, expectedStatus],
      );
      await recordResourceBookingDecision(client, departmentId, bookingId, actor, status);
      await client.query("COMMIT");
      context.realtime.publish("module:resource-scheduler:changed", departmentId, {});
      context.realtime.publish("module:church-calendar:changed", departmentId, { action: "resource-booking-status-updated", appointmentId: id });
      return { status };
    } catch (error) {
      await client.query("ROLLBACK");
      if (error && typeof error === "object" && "code" in error && error.code === "23P01") {
        return reply.code(409).send({ error: "This approval conflicts with another booking or exceeds the configured quantity." });
      }
      throw error;
    } finally { client.release(); }
  });
}
