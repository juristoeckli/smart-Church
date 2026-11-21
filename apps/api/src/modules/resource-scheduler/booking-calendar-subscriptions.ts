import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { foldIcsLine, hashFeedToken, icsEscape } from "../../calendar-feed-format.js";
import type { ModuleServerContext } from "../module-sdk.js";

const subscriptionPath = "/api/modules/resource-scheduler/my-bookings/subscription";
const feedPath = "/api/public/resource-scheduler/subscription.ics";
const activeAccount = "actor.is_enabled AND NOT actor.must_change_password AND NOT actor.is_service_user";
const enabledLocation = "'resource-scheduler'=ANY(department.enabled_modules)";
type FeedRow = {
  id: string | null;
  purpose: string;
  resourceName: string;
  location: string;
  status: "requested" | "approved";
  startsAt: string;
  endsAt: string;
  allDayDate: string | null;
};

function utcTimestamp(value: string | Date) {
  return new Date(value).toISOString().slice(0, 19).replace(/[-:]/g, "") + "Z";
}

function dateRange(date: string) {
  const end = new Date(`${date}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return [date.replaceAll("-", ""), end.toISOString().slice(0, 10).replaceAll("-", "")];
}

export function registerResourceCalendarSubscriptions(
  app: FastifyInstance, context: ModuleServerContext, location: (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>,
) {
  app.get(subscriptionPath, async (request, reply) => {
    const departmentId = await location(request, reply);
    if (!departmentId) return reply;
    const { rows: [flags] } = await context.pool!.query<{ active: boolean; canSubscribe: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM resource_booking_calendar_subscriptions subscription
                WHERE subscription.department_id=$1 AND subscription.user_id=$2) AS active,
              EXISTS(SELECT 1 FROM department_memberships membership
                JOIN departments department ON department.id=membership.department_id
                JOIN app_users actor ON actor.id=membership.user_id
                WHERE membership.department_id=$1 AND membership.user_id=$2 AND ${activeAccount} AND ${enabledLocation}) AS "canSubscribe"`,
      [departmentId, request.authenticatedUser!.id],
    );
    return reply.header("Cache-Control", "private, no-store").send(flags);
  });

  app.post(subscriptionPath, async (request, reply) => {
    const departmentId = await location(request, reply);
    if (!departmentId || !context.validateMutation(request, reply)) return reply;
    const token = randomBytes(32).toString("base64url");
    const client = await context.pool!.connect();
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "This location is read-only on this installation." });
      }
      const result = await client.query(
        `INSERT INTO resource_booking_calendar_subscriptions(department_id,user_id,token_hash)
          SELECT membership.department_id,membership.user_id,$3
            FROM department_memberships membership
            JOIN departments department ON department.id=membership.department_id
            JOIN app_users actor ON actor.id=membership.user_id
           WHERE membership.department_id=$1 AND membership.user_id=$2 AND ${activeAccount} AND ${enabledLocation}
          ON CONFLICT (department_id,user_id) DO UPDATE SET token_hash=EXCLUDED.token_hash`,
        [departmentId, request.authenticatedUser!.id, hashFeedToken(token)],
      );
      if (!result.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Booking subscriptions are unavailable for this account and location." });
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return reply.header("Cache-Control", "private, no-store").header("Referrer-Policy", "no-referrer")
      .code(201).send({ url: `${feedPath}?key=${token}` });
  });

  app.delete(subscriptionPath, async (request, reply) => {
    const departmentId = await location(request, reply);
    if (!departmentId || !context.validateMutation(request, reply)) return reply;
    const client = await context.pool!.connect();
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "This location is read-only on this installation." });
      }
      await client.query("DELETE FROM resource_booking_calendar_subscriptions WHERE department_id=$1 AND user_id=$2",
        [departmentId, request.authenticatedUser!.id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return reply.header("Cache-Control", "private, no-store").send({ revoked: true });
  });

  app.get<{ Querystring: { key: string } }>(feedPath, { schema: { querystring: {
    type: "object", additionalProperties: false, required: ["key"],
    properties: { key: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" } },
  } } }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store").header("Referrer-Policy", "no-referrer");
    if (!context.pool || !context.isDatabaseReady()) return reply.code(503).send({ error: "Booking subscriptions are unavailable." });
    const result = await context.pool.query<FeedRow>(
      `SELECT entry.*
         FROM resource_booking_calendar_subscriptions subscription
         JOIN department_memberships membership ON membership.department_id=subscription.department_id AND membership.user_id=subscription.user_id
         JOIN app_users actor ON actor.id=membership.user_id
         JOIN departments department ON department.id=membership.department_id
         LEFT JOIN LATERAL (
           SELECT booking.id,booking.purpose,resource.name AS "resourceName",resource.location,booking.status,
                  booking.starts_at AS "startsAt",booking.ends_at AS "endsAt",
                  CASE WHEN series.all_day_date IS NOT NULL AND day_override.all_day IS DISTINCT FROM FALSE
                       THEN to_char((occurrence.occurrence_starts_at AT TIME ZONE series.time_zone)::date,'YYYY-MM-DD') END AS "allDayDate"
             FROM resource_bookings booking
             JOIN bookable_resources resource ON resource.id=booking.resource_id AND resource.department_id=booking.department_id
             LEFT JOIN resource_booking_series_occurrences occurrence ON occurrence.resource_booking_id=booking.id AND occurrence.department_id=booking.department_id
             LEFT JOIN resource_booking_series series ON series.id=occurrence.series_id AND series.department_id=booking.department_id
             LEFT JOIN resource_booking_series_occurrence_overrides day_override
               ON day_override.series_id=series.id AND day_override.resource_booking_id=booking.id
               AND day_override.occurrence_date=(occurrence.occurrence_starts_at AT TIME ZONE COALESCE(series.time_zone,'UTC'))::date
            WHERE booking.department_id=subscription.department_id AND booking.requested_by=subscription.user_id
              AND resource.active AND booking.status IN ('requested','approved')
              AND booking.ends_at>now() AND booking.starts_at<now()+interval '366 days'
              AND can_view_bookable_resource(resource.department_id,resource.visibility_group_id,membership.user_id,false)
            ORDER BY booking.starts_at,booking.id LIMIT 2000
         ) entry ON true
        WHERE subscription.token_hash=$1 AND ${activeAccount} AND ${enabledLocation}
        ORDER BY entry."startsAt",entry.id`,
      [hashFeedToken(request.query.key)],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "Booking calendar feed not found." });

    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Smart-Church//Resource Bookings//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:My resource bookings"];
    const stamp = utcTimestamp(new Date());
    for (const booking of result.rows) {
      if (!booking.id) continue;
      lines.push("BEGIN:VEVENT", `UID:resource-booking-${booking.id}@smart-church`, `DTSTAMP:${stamp}`);
      if (booking.allDayDate) {
        const [start, end] = dateRange(booking.allDayDate);
        lines.push(`DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`);
      } else {
        lines.push(`DTSTART:${utcTimestamp(booking.startsAt)}`, `DTEND:${utcTimestamp(booking.endsAt)}`);
      }
      lines.push(`SUMMARY:${icsEscape(booking.purpose)}`, `LOCATION:${icsEscape(booking.location ? `${booking.resourceName} · ${booking.location}` : booking.resourceName)}`,
        `STATUS:${booking.status === "approved" ? "CONFIRMED" : "TENTATIVE"}`, "END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return reply.type("text/calendar; charset=utf-8").header("Content-Disposition", 'inline; filename="my-resource-bookings.ics"')
      .send(lines.map(foldIcsLine).join("\r\n") + "\r\n");
  });
}
