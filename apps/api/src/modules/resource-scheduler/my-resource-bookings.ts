import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";
import { canonicalTimeZone } from "../../calendar-time.js";
import { isResourceBookingManager } from "../../resource-booking-policy.js";

const statuses = ["requested", "approved", "declined", "cancelled"] as const;
const periods = ["upcoming", "past"] as const;
const pageSize = 25;
const cursorTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const cursorIdPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
type Status = typeof statuses[number];
type Period = typeof periods[number];
type BookingCursor = { anchor: string; start: string; id: string; period: Period; status: Status | null };
type Query = { period?: Period; status?: Status; cursor?: string };
type Location = (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>;

function validInstant(value: string) {
  const date = new Date(value);
  return !value.startsWith("0000") && Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function decodeCursor(value: string, period: Period, status: Status | null): BookingCursor | null {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) return null;
  try {
    const cursor: Partial<BookingCursor> = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!cursor || cursor.period !== period || cursor.status !== status
      || typeof cursor.anchor !== "string" || !validInstant(cursor.anchor)
      || typeof cursor.start !== "string" || !cursorTimePattern.test(cursor.start) || !validInstant(cursor.start.slice(0, 23) + "Z")
      || typeof cursor.id !== "string" || !cursorIdPattern.test(cursor.id)) return null;
    return { anchor: cursor.anchor, start: cursor.start, id: cursor.id, period, status };
  } catch { return null; }
}

export function registerMyResourceBookings(app: FastifyInstance, context: ModuleServerContext, location: Location) {
  app.get<{ Querystring: Query }>("/api/modules/resource-scheduler/my-bookings", {
    schema: { querystring: { type: "object", additionalProperties: false, properties: {
      period: { type: "string", enum: periods },
      status: { type: "string", enum: statuses },
      cursor: { type: "string", minLength: 1, maxLength: 400 },
    } } },
  }, async (request, reply) => {
    const departmentId = await location(request, reply);
    if (!departmentId) return reply;
    const userId = request.authenticatedUser?.id;
    if (!userId) return reply.code(401).send({ error: "Sign in to view your bookings." });
    const { period = "upcoming", status = null } = request.query;
    const cursor = request.query.cursor ? decodeCursor(request.query.cursor, period, status) : null;
    if (request.query.cursor && !cursor) return reply.code(400).send({ error: "Start again from the first bookings page." });
    const anchor = cursor?.anchor ?? new Date().toISOString();
    const ascending = period === "upcoming";
    const position = ascending ? ">" : "<";
    const ordering = ascending ? "ASC" : "DESC";
    const dateFilter = ascending ? ">" : "<=";
    const [department, bookings] = await Promise.all([
      context.pool!.query<{ time_zone: string | null }>("SELECT time_zone FROM departments WHERE id=$1", [departmentId]),
      context.pool!.query<{ id: string; cursorStart: string }>(
        `SELECT booking.id,resource.name AS "resourceName",resource.location,booking.purpose,booking.quantity,
                booking.status,CASE WHEN series.all_day_date IS NOT NULL THEN to_char((occurrence.occurrence_starts_at AT TIME ZONE series.time_zone)::date,'YYYY-MM-DD') END AS "allDayDate",booking.starts_at AS "startsAt",booking.ends_at AS "endsAt",
                to_char(booking.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorStart"
           FROM resource_bookings booking JOIN bookable_resources resource
             ON resource.id=booking.resource_id AND resource.department_id=booking.department_id
           LEFT JOIN resource_booking_series_occurrences occurrence ON occurrence.resource_booking_id=booking.id AND occurrence.department_id=booking.department_id
           LEFT JOIN resource_booking_series series ON series.id=occurrence.series_id AND series.department_id=booking.department_id
          WHERE booking.department_id=$1 AND booking.requested_by=$2
            AND ($3::boolean OR resource.active)
            AND ($4::text IS NULL OR booking.status=$4)
            AND booking.ends_at ${dateFilter} $5::timestamptz
            AND ($6::timestamptz IS NULL OR (booking.starts_at,booking.id) ${position} ($6::timestamptz,$7::uuid))
          ORDER BY booking.starts_at ${ordering},booking.id ${ordering} LIMIT $8`,
        [departmentId, userId, isResourceBookingManager(request), status, anchor, cursor?.start ?? null, cursor?.id ?? null, pageSize + 1],
      ),
    ]);
    const page = bookings.rows.slice(0, pageSize);
    const last = page.at(-1);
    const next = bookings.rows.length > pageSize && last
      ? Buffer.from(JSON.stringify({ anchor, start: last.cursorStart, id: last.id, period, status })).toString("base64url")
      : null;
    return reply.header("Cache-Control", "private, no-store").send({
      bookings: page.map(({ cursorStart: _cursorStart, ...booking }) => booking),
      nextCursor: next,
      timeZone: canonicalTimeZone(department.rows[0]?.time_zone) ?? "UTC",
    });
  });
}
