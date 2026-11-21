import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PublicRegistrationReceiptStatus } from "@smart-church/contracts";
import type { ModuleServerContext } from "./modules/module-sdk.js";

type Context = Pick<ModuleServerContext, "pool" | "isDatabaseReady" | "validateMutation" | "lockDepartmentForWrite">;

export function registerRegistrationReceiptRoutes(app: FastifyInstance, context: Context) {
  const receiptTokenSchema = { type: "string", pattern: "^[0-9a-f]{64}$" } as const;
  app.post<{ Body: { receiptToken: string } }>("/api/public/event-registrations/receipt", {
    schema: { body: { type: "object", additionalProperties: false, required: ["receiptToken"], properties: { receiptToken: receiptTokenSchema } } },
  }, async (request, reply): Promise<PublicRegistrationReceiptStatus | { error: string }> => {
    reply.header("Cache-Control", "private, no-store").header("Referrer-Policy", "no-referrer");
    if (!context.pool || !context.isDatabaseReady()) return reply.code(503).send({ error: "Event registration is temporarily unavailable." });
    const hash = createHash("sha256").update(request.body.receiptToken).digest("hex");
    const result = await context.pool.query<Omit<PublicRegistrationReceiptStatus, "endTime"> & { endTime: string | null }>(
      `SELECT event.title,event.event_date::text AS "eventDate",event.is_all_day AS "isAllDay",
              to_char(event.start_time,'HH24:MI') AS "startTime",to_char(event.end_time,'HH24:MI') AS "endTime",
              event.location,registration.status,event.cancelled_at IS NOT NULL AS "eventCancelled",
              (registration.status<>'cancelled' AND registration.checked_in_at IS NULL AND event.cancelled_at IS NULL
                AND event.event_date >= (now() AT TIME ZONE COALESCE(zone.name,'UTC'))::date) AS "canCancel"
         FROM event_registrations registration JOIN service_events event ON event.id=registration.event_id
         JOIN departments department ON department.id=event.department_id
         LEFT JOIN pg_timezone_names zone ON zone.name=department.time_zone
        WHERE registration.cancellation_token_hash=$1`, [hash],
    );
    const receipt = result.rows[0];
    if (!receipt) return reply.code(404).send({ error: "This registration receipt is unavailable." });
    const { endTime, ...status } = receipt;
    return { ...status, ...(endTime ? { endTime } : {}) };
  });

  app.put<{ Body: { receiptToken: string; enabled: boolean } }>("/api/events/registration-waitlist-notices", {
    schema: { body: { type: "object", additionalProperties: false, required: ["receiptToken", "enabled"], properties: {
      receiptToken: receiptTokenSchema, enabled: { type: "boolean" },
    } } },
  }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    if (!context.pool || !context.isDatabaseReady()) return reply.code(503).send({ error: "Event registration is temporarily unavailable." });
    if (!context.validateMutation(request, reply)) return reply;
    const userId = request.authenticatedUser?.id;
    if (!userId) return reply.code(401).send({ error: "Sign in to manage waitlist notices." });
    const hash = createHash("sha256").update(request.body.receiptToken).digest("hex");
    const client = await context.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: string; department_id: string; event_id: string; party_id: string | null }>(
        `SELECT registration.id,event.department_id,registration.event_id,registration.party_id
           FROM event_registrations registration JOIN service_events event ON event.id=registration.event_id
           JOIN department_memberships membership ON membership.department_id=event.department_id AND membership.user_id=$2
           JOIN app_users account ON account.id=membership.user_id AND lower(btrim(account.email))=lower(btrim(registration.email))
          WHERE registration.cancellation_token_hash=$1 AND registration.status IN ('registered','waitlisted')
            AND event.cancelled_at IS NULL AND event.event_date>=CURRENT_DATE
          FOR UPDATE OF event,registration`, [hash, userId],
      );
      const receipt = result.rows[0];
      if (!receipt) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "This waitlist receipt is unavailable for your account." });
      }
      if (!await context.lockDepartmentForWrite(client, receipt.department_id)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      const targets = await client.query<{ id: string }>(
        `SELECT waiting.id FROM event_registrations waiting JOIN app_users account ON account.id=$4
          WHERE waiting.event_id=$1 AND waiting.status='waitlisted' AND (waiting.id=$2 OR waiting.party_id=$3)
            AND lower(btrim(waiting.email))=lower(btrim(account.email))`,
        [receipt.event_id, receipt.id, receipt.party_id, userId],
      );
      const ids = targets.rows.map(({ id }) => id);
      if (request.body.enabled) {
        if (!ids.length) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "There are no waiting places for this registration." });
        }
        await client.query(
          `INSERT INTO event_registration_waitlist_notices(registration_id,department_id,user_id)
           SELECT registration_id,$2,$3 FROM unnest($1::uuid[]) registration(registration_id)
           ON CONFLICT(registration_id) DO UPDATE SET user_id=EXCLUDED.user_id,opted_in_at=now()`, [ids, receipt.department_id, userId],
        );
      } else {
        await client.query("DELETE FROM event_registration_waitlist_notices WHERE registration_id=ANY($1::uuid[]) AND department_id=$2 AND user_id=$3", [ids, receipt.department_id, userId]);
      }
      await client.query("COMMIT");
      return { enabled: request.body.enabled };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  });
}
