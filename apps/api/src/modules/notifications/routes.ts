import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { UserLanguage } from "@smart-church/contracts";
import type { ModuleServerContext } from "../module-sdk.js";
import type { PoolClient } from "pg";
import { renderNotificationEmail } from "./email-templates.js";

type NotificationRow = {
  id: string;
  kind: "announcement" | "event_reminder" | "service_request" | "follow_up_assignment" | "follow_up_reminder";
  title: string;
  body: string;
  event_id: string | null;
  related_contact_id: string | null;
  email_delivery_status: "pending" | "sent" | "delayed" | "delivered" | "bounced" | "complained" | "suppressed" | "failed" | "skipped" | null;
  created_at: Date | string;
  read_at: Date | string | null;
};

type PendingEmail = { notification_id: string; recipient_user_id: string; recipient_email: string; current_email: string | null; recipient_language: UserLanguage; email_enabled: boolean; email_suppressed: boolean; title: string; body: string; attempt_count: number };
type ResendWebhookPayload = { type?: string; data?: { email_id?: string; to?: string[]; [key: string]: unknown } };
type StoredResendEvent = { provider_event_id: string; event_type: string; provider_email_id: string };

const resendWebhookBodies = new WeakMap<FastifyRequest, Buffer>();

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value as Record<string, unknown>).sort().map((key) => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key])).join(",") + "}";
  return JSON.stringify(value);
}

function verifyResendWebhook(payload: Buffer, id: string, timestamp: string, signatures: string, secret: string) {
  const timestampSeconds = Number(timestamp);
  if (!Number.isInteger(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) return false;
  const signingSecret = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  let key: Buffer;
  try { key = Buffer.from(signingSecret, "base64"); } catch { return false; }
  if (!key.length) return false;
  const signedContent = `${id}.${timestamp}.${payload.toString("utf8")}`;
  const expected = createHmac("sha256", key).update(signedContent).digest();
  return signatures.split(" ").some((part) => {
    const [version, encoded] = part.split(",", 2);
    if (version !== "v1" || !encoded) return false;
    let received: Buffer;
    try { received = Buffer.from(encoded, "base64"); } catch { return false; }
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}

const announcementSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["title", "body", "audience", "groupIds"],
    properties: {
      title: { type: "string", minLength: 1, maxLength: 120 },
      body: { type: "string", minLength: 1, maxLength: 2000 },
      audience: { type: "string", enum: ["location", "groups"] },
      groupIds: { type: "array", maxItems: 100, uniqueItems: true, items: { type: "string", format: "uuid" } },
    },
  },
};

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation } = context;
  let reminderTimer: ReturnType<typeof setInterval> | undefined;
  let storageReady = false;

  async function writableDepartmentIds() {
    if (!pool) return [];
    try {
      const result = await pool.query<{ id: string }>(`SELECT department.id FROM departments department
        LEFT JOIN sync_site_redundancy redundancy ON redundancy.department_id=department.id
        WHERE COALESCE(redundancy.role,'primary')='primary'`);
      return result.rows.map((row) => row.id);
    } catch (error) {
      // Older installations without the Sync migration cannot have configured
      // redundancy. Any other database error must stop the worker fail-closed.
      if ((error as { code?: string })?.code !== "42P01") throw error;
      const result = await pool.query<{ id: string }>("SELECT id FROM departments");
      return result.rows.map((row) => row.id);
    }
  }

  context.replication.register({
    schemaVersion: "1",
    inspect: async (departmentId) => {
      if (!pool || !isDatabaseReady()) return { ready: false, blockers: ["Notifications database is unavailable."], recordCount: 0 };
      try {
        const result = await pool.query<{ notifications: string; preferences: string; deliveries: string; emailEnabled: boolean }>(
          `SELECT (SELECT count(*) FROM module_notifications WHERE department_id=$1)::text notifications,
                  (SELECT count(*) FROM module_notification_preferences WHERE department_id=$1)::text preferences,
                  (SELECT count(*) FROM module_notification_email_deliveries d JOIN module_notifications n ON n.id=d.notification_id WHERE n.department_id=$1)::text deliveries,
                  EXISTS(SELECT 1 FROM module_notification_preferences WHERE department_id=$1 AND email_notifications_enabled) email_enabled`, [departmentId]);
        const row = result.rows[0];
        const ready = !row.emailEnabled || await context.email.isConfigured();
        return { ready, blockers: ready ? [] : ["Email notifications are enabled for this site but the email connector is not configured on this server."], recordCount: Number(row.notifications) + Number(row.preferences) + Number(row.deliveries) };
      } catch {
        return { ready: false, blockers: ["Notifications storage is not initialized on this server."], recordCount: 0 };
      }
    },
    exportSnapshot: async (client: PoolClient, departmentId) => {
      const notifications = await client.query("SELECT id,recipient_user_id,sender_user_id,kind,title,body,event_id,related_event_id,related_contact_id,created_at,read_at FROM module_notifications WHERE department_id=$1 ORDER BY created_at,id", [departmentId]);
      const preferences = await client.query("SELECT user_id,event_reminders_enabled,service_requests_enabled,follow_ups_enabled,email_notifications_enabled,updated_at FROM module_notification_preferences WHERE department_id=$1 ORDER BY user_id", [departmentId]);
      const deliveries = await client.query("SELECT d.notification_id,d.recipient_email,d.provider_email_id,d.status,d.attempt_count,d.next_attempt_at,d.last_error,d.sent_at,d.created_at,d.updated_at FROM module_notification_email_deliveries d JOIN module_notifications n ON n.id=d.notification_id WHERE n.department_id=$1 ORDER BY d.notification_id", [departmentId]);
      const suppressions = await client.query("SELECT email,reason,provider_event_id,created_at FROM module_notification_email_suppressions ORDER BY email");
      return { version: 1, notifications: notifications.rows, preferences: preferences.rows, deliveries: deliveries.rows, suppressions: suppressions.rows };
    },
    restoreSnapshot: async (client: PoolClient, departmentId, input, restoreContext) => {
      const snapshot = input as { version?: unknown; notifications?: Array<Record<string, unknown>>; preferences?: Array<Record<string, unknown>>; deliveries?: Array<Record<string, unknown>>; suppressions?: Array<Record<string, unknown>> };
      if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.notifications) || !Array.isArray(snapshot.preferences) || !Array.isArray(snapshot.deliveries) || !Array.isArray(snapshot.suppressions)) throw new Error("The Notifications snapshot is invalid.");
      await client.query("DELETE FROM module_notification_preferences WHERE department_id=$1", [departmentId]);
      await client.query("DELETE FROM module_notifications WHERE department_id=$1", [departmentId]);
      for (const row of snapshot.notifications) {
        const recipientId = restoreContext.userIdMap.get(String(row.recipient_user_id));
        const senderId = row.sender_user_id == null ? null : restoreContext.userIdMap.get(String(row.sender_user_id)) ?? null;
        if (!recipientId) throw new Error("A notification recipient has no matching account on the standby server.");
        await client.query("INSERT INTO module_notifications(id,department_id,recipient_user_id,sender_user_id,kind,title,body,event_id,related_event_id,related_contact_id,created_at,read_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [row.id, departmentId, recipientId, senderId, row.kind, row.title, row.body, row.event_id, row.related_event_id, row.related_contact_id, row.created_at, row.read_at]);
      }
      for (const row of snapshot.preferences) {
        const userId = restoreContext.userIdMap.get(String(row.user_id));
        if (!userId) throw new Error("A notification preference has no matching account on the standby server.");
        await client.query("INSERT INTO module_notification_preferences(department_id,user_id,event_reminders_enabled,service_requests_enabled,follow_ups_enabled,email_notifications_enabled,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [departmentId, userId, row.event_reminders_enabled, row.service_requests_enabled, row.follow_ups_enabled, row.email_notifications_enabled, row.updated_at]);
      }
      for (const row of snapshot.deliveries) await client.query("INSERT INTO module_notification_email_deliveries(notification_id,recipient_email,provider_email_id,status,attempt_count,next_attempt_at,last_error,sent_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(notification_id) DO UPDATE SET recipient_email=EXCLUDED.recipient_email,provider_email_id=EXCLUDED.provider_email_id,status=EXCLUDED.status,attempt_count=EXCLUDED.attempt_count,next_attempt_at=EXCLUDED.next_attempt_at,last_error=EXCLUDED.last_error,sent_at=EXCLUDED.sent_at,updated_at=EXCLUDED.updated_at", [row.notification_id, row.recipient_email, row.provider_email_id, row.status, row.attempt_count, row.next_attempt_at, row.last_error, row.sent_at, row.created_at, row.updated_at]);
      for (const row of snapshot.suppressions) await client.query("INSERT INTO module_notification_email_suppressions(email,reason,provider_event_id,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO UPDATE SET reason=EXCLUDED.reason,provider_event_id=EXCLUDED.provider_event_id,created_at=LEAST(module_notification_email_suppressions.created_at,EXCLUDED.created_at)", [row.email, row.reason, row.provider_event_id, row.created_at]);
      return { recordCount: snapshot.notifications.length + snapshot.preferences.length + snapshot.deliveries.length };
    },
    verifySnapshot: async (client: PoolClient, departmentId, input, restoreContext) => {
      const snapshot = input as { version?: unknown; notifications?: Array<Record<string, unknown>>; preferences?: Array<Record<string, unknown>>; deliveries?: Array<Record<string, unknown>>; suppressions?: Array<Record<string, unknown>> };
      if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.notifications) || !Array.isArray(snapshot.preferences) || !Array.isArray(snapshot.deliveries) || !Array.isArray(snapshot.suppressions)) return { ready: false, blockers: ["No verified Notifications snapshot is available."] };
      const actualNotifications = (await client.query("SELECT id,recipient_user_id,sender_user_id,kind,title,body,event_id,related_event_id,related_contact_id,created_at,read_at FROM module_notifications WHERE department_id=$1 ORDER BY created_at,id", [departmentId])).rows as Array<Record<string, unknown>>;
      const actualPreferences = (await client.query("SELECT user_id,event_reminders_enabled,service_requests_enabled,follow_ups_enabled,email_notifications_enabled,updated_at FROM module_notification_preferences WHERE department_id=$1 ORDER BY user_id", [departmentId])).rows as Array<Record<string, unknown>>;
      const actualDeliveries = (await client.query("SELECT d.notification_id,d.recipient_email,d.provider_email_id,d.status,d.attempt_count,d.next_attempt_at,d.last_error,d.sent_at,d.created_at,d.updated_at FROM module_notification_email_deliveries d JOIN module_notifications n ON n.id=d.notification_id WHERE n.department_id=$1 ORDER BY d.notification_id", [departmentId])).rows as Array<Record<string, unknown>>;
      const mapping = restoreContext?.userIdMap ?? new Map<string, string>();
      const remap = (rows: Array<Record<string, unknown>>, fields: string[]) => rows.map((source) => {
        const row = { ...source };
        for (const field of fields) if (typeof row[field] === "string") row[field] = mapping.get(String(row[field])) ?? (field === "sender_user_id" ? null : row[field]);
        return row;
      });
      const same = (expected: Array<Record<string, unknown>>, actual: Array<Record<string, unknown>>) => {
        if (expected.length !== actual.length) return false;
        const left = expected.map(canonical).sort(); const right = actual.map(canonical).sort();
        return left.every((row, index) => row === right[index]);
      };
      if (!same(remap(snapshot.notifications, ["recipient_user_id", "sender_user_id"]), actualNotifications)
        || !same(remap(snapshot.preferences, ["user_id"]), actualPreferences)
        || !same(snapshot.deliveries, actualDeliveries)) return { ready: false, blockers: ["Notification or email delivery records differ from the source snapshot after restore."] };
      const actualSuppressions = await client.query<{ email: string; reason: string; provider_event_id: string }>("SELECT email,reason,provider_event_id FROM module_notification_email_suppressions");
      const suppressionMap = new Map(actualSuppressions.rows.map((row) => [row.email, row]));
      if (snapshot.suppressions.some((row) => {
        const saved = suppressionMap.get(String(row.email));
        return !saved || saved.reason !== row.reason || saved.provider_event_id !== row.provider_event_id;
      })) return { ready: false, blockers: ["One or more email bounce suppressions are missing on the standby."] };
      return { ready: true, blockers: [] };
    },
  });

  async function createUpcomingReminders() {
    if (!pool || !isDatabaseReady()) return;
    const writableIds = await writableDepartmentIds();
    if (!writableIds.length) return;
    await pool.query(
      `INSERT INTO module_notifications (id, department_id, recipient_user_id, kind, title, body, event_id)
       SELECT gen_random_uuid(), e.department_id, m.user_id, 'event_reminder',
              'Coming up tomorrow: ' || e.title,
              '“' || e.title || '” is scheduled for ' || to_char(e.event_date, 'FMDay, FMDD FMMonth') || ' at ' || to_char(e.start_time, 'HH24:MI') ||
                CASE WHEN COALESCE(e.room, '') <> '' THEN ' in ' || e.room ELSE '' END || '.',
              e.id
         FROM service_events e
         JOIN departments d ON d.id = e.department_id
         JOIN department_memberships m ON m.department_id = e.department_id
         LEFT JOIN module_notification_preferences p ON p.department_id = e.department_id AND p.user_id = m.user_id
        WHERE ((e.event_date + e.start_time) AT TIME ZONE d.time_zone) BETWEEN now() + interval '23 hours 50 minutes' AND now() + interval '24 hours 10 minutes'
          AND e.department_id = ANY($1::uuid[])
          AND COALESCE(p.event_reminders_enabled, true)
       ON CONFLICT DO NOTHING`, [writableIds],
    );
    await pool.query(
      `INSERT INTO module_notifications (id,department_id,recipient_user_id,kind,title,body,related_event_id,related_contact_id)
       SELECT gen_random_uuid(),e.department_id,m.user_id,'follow_up_assignment',
              'Visitor follow-up: ' || c.first_name || ' ' || c.last_name,
              'You are assigned to follow up with ' || c.first_name || ' ' || c.last_name || ' after their first visit to ' || e.title ||
                CASE WHEN f.follow_up_due_date IS NULL THEN '.' ELSE '. Due ' || to_char(f.follow_up_due_date,'FMDD FMMonth YYYY') || '.' END,
              e.id,c.id
         FROM event_attendance_checkins f
         JOIN service_events e ON e.id=f.event_id
         JOIN contacts c ON c.id=f.contact_id AND c.department_id=e.department_id
         JOIN departments d ON d.id=e.department_id
         JOIN department_memberships m ON m.department_id=e.department_id AND m.contact_id=f.assigned_contact_id
         LEFT JOIN module_notification_preferences preference ON preference.department_id=e.department_id AND preference.user_id=m.user_id
        WHERE f.first_time_visitor=true AND f.follow_up_status='needed' AND f.assigned_contact_id IS NOT NULL
          AND e.department_id = ANY($1::uuid[])
          AND COALESCE(preference.follow_ups_enabled,true)
       ON CONFLICT DO NOTHING`, [writableIds],
    );
    await pool.query(
      `INSERT INTO module_notifications (id,department_id,recipient_user_id,kind,title,body,related_event_id,related_contact_id)
       SELECT gen_random_uuid(),e.department_id,m.user_id,'follow_up_reminder',
              'Follow-up due soon: ' || c.first_name || ' ' || c.last_name,
              'Your follow-up with ' || c.first_name || ' ' || c.last_name || ' after their first visit to ' || e.title ||
                ' is due ' || to_char(f.follow_up_due_date,'FMDay, FMDD FMMonth') || '.',
              e.id,c.id
         FROM event_attendance_checkins f
         JOIN service_events e ON e.id=f.event_id
         JOIN contacts c ON c.id=f.contact_id AND c.department_id=e.department_id
         JOIN departments d ON d.id=e.department_id
         JOIN department_memberships m ON m.department_id=e.department_id AND m.contact_id=f.assigned_contact_id
         LEFT JOIN module_notification_preferences preference ON preference.department_id=e.department_id AND preference.user_id=m.user_id
        WHERE f.first_time_visitor=true AND f.follow_up_status='needed' AND f.assigned_contact_id IS NOT NULL
          AND e.department_id = ANY($1::uuid[])
          AND f.follow_up_due_date BETWEEN (now() AT TIME ZONE d.time_zone)::date AND ((now() AT TIME ZONE d.time_zone)::date + 1)
          AND COALESCE(preference.follow_ups_enabled,true)
       ON CONFLICT DO NOTHING`, [writableIds],
    );
    await pool.query(
      `INSERT INTO module_notifications (id,department_id,recipient_user_id,kind,title,body,event_id)
       SELECT gen_random_uuid(),e.department_id,m.user_id,'service_request',
              'Please respond: ' || e.title,
              'You are assigned to ' || string_agg(DISTINCT p.position->>'name', ', ' ORDER BY p.position->>'name') ||
                ' for ' || to_char(e.event_date,'FMDay, FMDD FMMonth') || ' at ' || to_char(e.start_time,'HH24:MI') ||
                CASE WHEN COALESCE(e.room,'')<>'' THEN ' in ' || e.room ELSE '' END || '. Open Services & events to accept or decline.',
              e.id
         FROM service_events e
         JOIN departments d ON d.id=e.department_id
         CROSS JOIN LATERAL jsonb_array_elements(e.positions) WITH ORDINALITY AS p(position,ordinal)
         JOIN event_position_responses r ON r.event_id=e.id AND r.position_index=(p.ordinal-1)::integer AND r.status='pending'
         JOIN department_memberships m ON m.department_id=e.department_id AND m.contact_id=r.contact_id
         LEFT JOIN module_notification_preferences preference ON preference.department_id=e.department_id AND preference.user_id=m.user_id
        WHERE ((e.event_date+e.start_time) AT TIME ZONE d.time_zone) > now()
          AND e.department_id = ANY($1::uuid[])
          AND ((e.event_date+e.start_time) AT TIME ZONE d.time_zone) < now()+interval '30 days'
          AND COALESCE(preference.service_requests_enabled,true)
        GROUP BY e.department_id,m.user_id,e.id,e.title,e.event_date,e.start_time,e.room
       ON CONFLICT DO NOTHING`, [writableIds],
    );
  }

  async function deliverPendingEmails() {
    if (!pool || !isDatabaseReady() || !await context.email.isConfigured()) return;
    const writableIds = await writableDepartmentIds();
    if (!writableIds.length) return;
    for (let sent = 0; sent < 20; sent += 1) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query<PendingEmail>(
          `SELECT delivery.notification_id,notification.recipient_user_id,delivery.recipient_email,account.email AS current_email,account.language AS recipient_language,
                  COALESCE(preference.email_notifications_enabled,false) AS email_enabled,
                  (suppressed.email IS NOT NULL) AS email_suppressed,
                  notification.title,notification.body,delivery.attempt_count
             FROM module_notification_email_deliveries delivery
             JOIN module_notifications notification ON notification.id=delivery.notification_id
             JOIN app_users account ON account.id=notification.recipient_user_id
             LEFT JOIN module_notification_preferences preference ON preference.department_id=notification.department_id AND preference.user_id=notification.recipient_user_id
             LEFT JOIN module_notification_email_suppressions suppressed ON suppressed.email=lower(trim(account.email))
            WHERE notification.department_id = ANY($1::uuid[]) AND delivery.status IN ('pending','failed') AND delivery.attempt_count < 8 AND delivery.next_attempt_at <= now()
            ORDER BY delivery.created_at
            LIMIT 1 FOR UPDATE OF delivery SKIP LOCKED`, [writableIds],
        );
        if (!result.rowCount) { await client.query("COMMIT"); break; }
        const delivery = result.rows[0];
        if (!delivery.email_enabled || !delivery.current_email || delivery.email_suppressed) {
          await client.query("UPDATE module_notification_email_deliveries SET status='skipped',last_error=CASE WHEN $2 THEN 'Address suppressed after a bounce or complaint.' ELSE NULL END,updated_at=now() WHERE notification_id=$1", [delivery.notification_id, delivery.email_suppressed]);
          await client.query("COMMIT");
          continue;
        }
        const attempts = delivery.attempt_count + 1;
        try {
          const emailContent = renderNotificationEmail(delivery.title, delivery.body, process.env.SMART_CHURCH_WEB_ORIGIN, delivery.recipient_language);
          const sent = await context.email.send({
            recipientUserId: delivery.recipient_user_id,
            ...emailContent,
          });
          await client.query("UPDATE module_notification_email_deliveries SET recipient_email=$2,provider_email_id=$3,status='sent',attempt_count=$4,sent_at=now(),last_error=NULL,updated_at=now() WHERE notification_id=$1", [delivery.notification_id, delivery.current_email, sent.messageId, attempts]);
        } catch (error) {
          const message = error instanceof Error ? error.message.slice(0, 500) : "Email delivery failed.";
          await client.query(
            `UPDATE module_notification_email_deliveries
                SET recipient_email=$2,status='failed',attempt_count=$3,
                    next_attempt_at=CASE WHEN $3 < 8 THEN now() + LEAST($3 * 2,60) * interval '1 minute' ELSE NULL END,
                    last_error=$4,updated_at=now()
              WHERE notification_id=$1`,
            [delivery.notification_id, delivery.current_email, attempts, message],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    }
    await processPendingWebhookEvents(writableIds);
  }

  async function processPendingWebhookEvents(writableIds?: string[]) {
    if (!pool || !isDatabaseReady()) return;
    const allowedDepartmentIds = writableIds ?? await writableDepartmentIds();
    if (!allowedDepartmentIds.length) return;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const events = await client.query<StoredResendEvent>(
        `SELECT webhook_event.provider_event_id,webhook_event.event_type,webhook_event.provider_email_id
           FROM module_notification_webhook_events webhook_event
           JOIN module_notification_email_deliveries delivery ON delivery.provider_email_id=webhook_event.provider_email_id
           JOIN module_notifications notification ON notification.id=delivery.notification_id
          WHERE notification.department_id=ANY($1::uuid[]) AND webhook_event.processed_at IS NULL AND webhook_event.received_at >= now() - interval '1 day'
          ORDER BY webhook_event.received_at LIMIT 100 FOR UPDATE OF webhook_event SKIP LOCKED`,
        [allowedDepartmentIds],
      );
      const statusByType: Record<string, "sent" | "delayed" | "delivered" | "bounced" | "complained" | "suppressed" | "failed"> = {
        "email.sent": "sent", "email.delivery_delayed": "delayed", "email.delivered": "delivered",
        "email.bounced": "bounced", "email.complained": "complained", "email.suppressed": "suppressed", "email.failed": "failed",
      };
      for (const event of events.rows) {
        const status = statusByType[event.event_type];
        if (!status) {
          await client.query("UPDATE module_notification_webhook_events SET processed_at=now() WHERE provider_event_id=$1", [event.provider_event_id]);
          continue;
        }
        const updated = await client.query<{ recipient_email: string }>(
          `UPDATE module_notification_email_deliveries
              SET status=CASE
                    WHEN status='complained' THEN status
                    WHEN status IN ('bounced','suppressed') AND $2 NOT IN ('bounced','complained','suppressed') THEN status
                    WHEN status='delivered' AND $2 IN ('sent','delayed','failed') THEN status
                    ELSE $2 END,
                  attempt_count=CASE WHEN $2='failed' THEN 8 ELSE attempt_count END,
                  next_attempt_at=CASE WHEN $2='failed' THEN NULL ELSE next_attempt_at END,
                  last_error=CASE WHEN $2 IN ('bounced','complained','suppressed','failed','delayed') THEN $3 ELSE NULL END,
                  updated_at=now()
            WHERE provider_email_id=$1
            RETURNING recipient_email`,
          [event.provider_email_id, status, null],
        );
        if (!updated.rowCount) continue;
        if (status === "bounced" || status === "complained" || status === "suppressed") {
          await client.query(
            `INSERT INTO module_notification_email_suppressions (email,reason,provider_event_id)
             VALUES (lower(trim($1)),$2,$3)
             ON CONFLICT (email) DO UPDATE SET
               reason=CASE WHEN module_notification_email_suppressions.reason='email.complained' THEN module_notification_email_suppressions.reason ELSE EXCLUDED.reason END,
               provider_event_id=EXCLUDED.provider_event_id`,
            [updated.rows[0].recipient_email, event.event_type, event.provider_event_id],
          );
        }
        await client.query("UPDATE module_notification_webhook_events SET processed_at=now() WHERE provider_event_id=$1", [event.provider_event_id]);
      }
      await client.query("UPDATE module_notification_webhook_events SET processed_at=now() WHERE processed_at IS NULL AND received_at < now() - interval '1 day'");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  app.register(async (routes) => {
    routes.addHook("preParsing", async (request, _reply, payload) => {
      if (request.url.split("?", 1)[0] !== "/api/webhooks/resend") return payload;
      const chunks: Buffer[] = [];
      for await (const chunk of payload) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const rawBody = Buffer.concat(chunks);
      resendWebhookBodies.set(request, rawBody);
      return Readable.from([rawBody]);
    });
    routes.addHook("onReady", async () => {
      if (!pool || !isDatabaseReady()) return;
      try {
        await pool.query(`
        CREATE TABLE IF NOT EXISTS module_notifications (
          id UUID PRIMARY KEY,
          department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
          recipient_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          sender_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
          kind TEXT NOT NULL CHECK (kind IN ('announcement', 'event_reminder', 'service_request', 'follow_up_assignment', 'follow_up_reminder')),
          title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
          body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
          event_id UUID REFERENCES service_events(id) ON DELETE CASCADE,
          related_event_id UUID REFERENCES service_events(id) ON DELETE CASCADE,
          related_contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          read_at TIMESTAMPTZ,
          UNIQUE (department_id, recipient_user_id, event_id, kind)
        );
        CREATE INDEX IF NOT EXISTS module_notifications_recipient_created_idx
          ON module_notifications (department_id, recipient_user_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS module_notification_preferences (
          department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          event_reminders_enabled BOOLEAN NOT NULL DEFAULT true,
          service_requests_enabled BOOLEAN NOT NULL DEFAULT true,
          follow_ups_enabled BOOLEAN NOT NULL DEFAULT true,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (department_id, user_id)
        );
        ALTER TABLE module_notifications DROP CONSTRAINT IF EXISTS module_notifications_kind_check;
        ALTER TABLE module_notifications ADD COLUMN IF NOT EXISTS related_contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE;
        ALTER TABLE module_notifications ADD COLUMN IF NOT EXISTS related_event_id UUID REFERENCES service_events(id) ON DELETE CASCADE;
        ALTER TABLE module_notifications ADD CONSTRAINT module_notifications_kind_check CHECK (kind IN ('announcement','event_reminder','service_request','follow_up_assignment','follow_up_reminder'));
        DROP INDEX IF EXISTS module_notifications_follow_up_unique_idx;
        CREATE UNIQUE INDEX IF NOT EXISTS module_notifications_follow_up_unique_idx
          ON module_notifications (department_id,recipient_user_id,kind,related_event_id,related_contact_id)
          WHERE kind IN ('follow_up_assignment','follow_up_reminder') AND related_event_id IS NOT NULL AND related_contact_id IS NOT NULL;
        ALTER TABLE module_notification_preferences ADD COLUMN IF NOT EXISTS service_requests_enabled BOOLEAN NOT NULL DEFAULT true;
        ALTER TABLE module_notification_preferences ADD COLUMN IF NOT EXISTS follow_ups_enabled BOOLEAN NOT NULL DEFAULT true;
        ALTER TABLE module_notification_preferences ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN NOT NULL DEFAULT false;
        CREATE TABLE IF NOT EXISTS module_notification_email_deliveries (
          notification_id UUID PRIMARY KEY REFERENCES module_notifications(id) ON DELETE CASCADE,
          recipient_email TEXT NOT NULL,
          provider_email_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','delayed','delivered','bounced','complained','suppressed','failed','skipped')),
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
          next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_error TEXT,
          sent_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        ALTER TABLE module_notification_email_deliveries DROP CONSTRAINT IF EXISTS module_notification_email_deliveries_status_check;
        ALTER TABLE module_notification_email_deliveries ADD CONSTRAINT module_notification_email_deliveries_status_check CHECK (status IN ('pending','sent','delayed','delivered','bounced','complained','suppressed','failed','skipped'));
        CREATE INDEX IF NOT EXISTS module_notification_email_pending_idx
          ON module_notification_email_deliveries (next_attempt_at,created_at)
          WHERE status IN ('pending','failed');
        ALTER TABLE module_notification_email_deliveries ADD COLUMN IF NOT EXISTS provider_email_id TEXT;
        CREATE UNIQUE INDEX IF NOT EXISTS module_notification_email_provider_id_idx
          ON module_notification_email_deliveries (provider_email_id) WHERE provider_email_id IS NOT NULL;
        CREATE TABLE IF NOT EXISTS module_notification_email_suppressions (
          email TEXT PRIMARY KEY,
          reason TEXT NOT NULL,
          provider_event_id TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS module_notification_webhook_events (
          provider_event_id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          provider_email_id TEXT NOT NULL,
          received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          processed_at TIMESTAMPTZ
        );
        ALTER TABLE module_notification_webhook_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
        CREATE OR REPLACE FUNCTION queue_module_notification_email() RETURNS trigger AS $$
        BEGIN
          INSERT INTO module_notification_email_deliveries (notification_id,recipient_email)
          SELECT NEW.id,account.email
            FROM app_users account
            JOIN module_notification_preferences preference ON preference.user_id=account.id AND preference.department_id=NEW.department_id
           WHERE account.id=NEW.recipient_user_id AND account.email IS NOT NULL AND preference.email_notifications_enabled=true
             AND NOT EXISTS (SELECT 1 FROM module_notification_email_suppressions suppressed WHERE suppressed.email=lower(trim(account.email)))
          ON CONFLICT (notification_id) DO NOTHING;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        DROP TRIGGER IF EXISTS module_notifications_queue_email ON module_notifications;
        CREATE TRIGGER module_notifications_queue_email AFTER INSERT ON module_notifications
          FOR EACH ROW EXECUTE FUNCTION queue_module_notification_email();
      `);
        await createUpcomingReminders();
        await deliverPendingEmails();
        await processPendingWebhookEvents();
        storageReady = true;
        reminderTimer = setInterval(() => { void createUpcomingReminders().then(deliverPendingEmails).then(processPendingWebhookEvents).catch((error) => routes.log.error({ err: error }, "Could not process notification jobs.")); }, 60_000);
        reminderTimer.unref?.();
      } catch (error) {
        routes.log.error({ err: error }, "Optional Notifications storage could not be initialized; the rest of Smart-Church will continue.");
      }
    });
    routes.addHook("onClose", async () => { if (reminderTimer) clearInterval(reminderTimer); });

    async function department(request: FastifyRequest, reply: FastifyReply) {
      if (!pool || !isDatabaseReady() || !storageReady) {
        reply.code(503).send({ error: "Notifications are temporarily unavailable because their storage could not be initialized." });
        return null;
      }
      return resolveDepartmentId(request, reply);
    }

    routes.post("/api/webhooks/resend", async (request, reply) => {
      if (!pool || !isDatabaseReady() || !storageReady) return reply.code(503).send({ error: "Email delivery storage is unavailable." });
      const secret = process.env.SMART_CHURCH_RESEND_WEBHOOK_SECRET?.trim();
      if (!secret) return reply.code(503).send({ error: "Resend webhook verification is not configured." });
      const rawBody = resendWebhookBodies.get(request);
      const id = request.headers["svix-id"];
      const timestamp = request.headers["svix-timestamp"];
      const signature = request.headers["svix-signature"];
      if (!rawBody || typeof id !== "string" || typeof timestamp !== "string" || typeof signature !== "string" || !verifyResendWebhook(rawBody, id, timestamp, signature, secret)) {
        return reply.code(400).send({ error: "Invalid Resend webhook signature." });
      }
      const payload = request.body as ResendWebhookPayload;
      const emailId = payload?.data?.email_id;
      const type = payload?.type;
      const supportedEvents = new Set(["email.sent", "email.delivery_delayed", "email.delivered", "email.bounced", "email.complained", "email.suppressed", "email.failed"]);
      if (typeof type !== "string" || !supportedEvents.has(type) || typeof emailId !== "string" || !emailId) return { received: true, ignored: true };
      const client = await pool.connect();
      let duplicate = false;
      try {
        await client.query("BEGIN");
        const logged = await client.query(
          "INSERT INTO module_notification_webhook_events (provider_event_id,event_type,provider_email_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING provider_event_id",
          [id, type, emailId],
        );
        duplicate = !logged.rowCount;
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
      await processPendingWebhookEvents();
      return { received: true, duplicate };
    });

    routes.get("/api/modules/notifications", async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const result = await pool!.query<NotificationRow>(
        `SELECT notification.id, notification.kind, notification.title, notification.body,
                COALESCE(notification.event_id,notification.related_event_id) AS event_id,
                notification.related_contact_id,delivery.status AS email_delivery_status,notification.created_at,notification.read_at
           FROM module_notifications notification
           LEFT JOIN module_notification_email_deliveries delivery ON delivery.notification_id=notification.id
          WHERE notification.department_id = $1 AND notification.recipient_user_id = $2
          ORDER BY notification.created_at DESC LIMIT 100`,
        [departmentId, request.authenticatedUser!.id],
      );
      const preferences = await pool!.query(
        `SELECT event_reminders_enabled,service_requests_enabled,follow_ups_enabled,email_notifications_enabled FROM module_notification_preferences WHERE department_id = $1 AND user_id = $2`,
        [departmentId, request.authenticatedUser!.id],
      );
      const account = await pool!.query<{ email: string | null }>("SELECT email FROM app_users WHERE id=$1", [request.authenticatedUser!.id]);
      const suppression = account.rows[0]?.email ? await pool!.query("SELECT email FROM module_notification_email_suppressions WHERE email=lower(trim($1))", [account.rows[0].email]) : { rowCount: 0 };
      const notifications = result.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        ...(row.event_id ? { eventId: row.event_id } : {}),
        ...(row.related_contact_id ? { contactId: row.related_contact_id } : {}),
        ...(row.email_delivery_status ? { emailDeliveryStatus: row.email_delivery_status } : {}),
        createdAt: new Date(row.created_at).toISOString(),
        ...(row.read_at ? { readAt: new Date(row.read_at).toISOString() } : {}),
      }));
      return {
        notifications,
        unreadCount: notifications.filter((item) => !item.readAt).length,
        eventRemindersEnabled: preferences.rows[0]?.event_reminders_enabled ?? true,
        serviceRequestsEnabled: preferences.rows[0]?.service_requests_enabled ?? true,
        followUpsEnabled: preferences.rows[0]?.follow_ups_enabled ?? true,
        emailEnabled: preferences.rows[0]?.email_notifications_enabled ?? false,
        emailAddress: account.rows[0]?.email ?? null,
        emailDeliveryConfigured: await context.email.isConfigured(),
        emailSuppressed: Boolean(suppression.rowCount),
        canSend: request.activeDepartmentRole === "site_admin",
      };
    });

    routes.post<{ Params: { id: string } }>("/api/modules/notifications/:id/read", {
      schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
    }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const result = await pool!.query(
        `UPDATE module_notifications SET read_at = COALESCE(read_at, now())
          WHERE id = $1 AND department_id = $2 AND recipient_user_id = $3 RETURNING id`,
        [request.params.id, departmentId, request.authenticatedUser!.id],
      );
      if (!result.rowCount) return reply.code(404).send({ error: "Notification not found." });
      return { read: true };
    });

    routes.post("/api/modules/notifications/read-all", async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      await pool!.query(
        `UPDATE module_notifications SET read_at = now()
          WHERE department_id = $1 AND recipient_user_id = $2 AND read_at IS NULL`,
        [departmentId, request.authenticatedUser!.id],
      );
      return { read: true };
    });

    routes.put<{ Body: { eventRemindersEnabled: boolean; serviceRequestsEnabled: boolean; followUpsEnabled: boolean; emailEnabled: boolean } }>("/api/modules/notifications/preferences", {
      schema: { body: { type: "object", additionalProperties: false, required: ["eventRemindersEnabled", "serviceRequestsEnabled", "followUpsEnabled", "emailEnabled"], properties: { eventRemindersEnabled: { type: "boolean" }, serviceRequestsEnabled: { type: "boolean" }, followUpsEnabled: { type: "boolean" }, emailEnabled: { type: "boolean" } } } },
    }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      if (request.body.emailEnabled && !await context.email.isConfigured()) {
        const existing = await pool!.query<{ email_notifications_enabled: boolean }>("SELECT email_notifications_enabled FROM module_notification_preferences WHERE department_id=$1 AND user_id=$2", [departmentId, request.authenticatedUser!.id]);
        if (!existing.rows[0]?.email_notifications_enabled) return reply.code(503).send({ error: "Email delivery is not configured by the Smart-Church administrator." });
      }
      if (request.body.emailEnabled) {
        const account = await pool!.query<{ email: string | null }>("SELECT email FROM app_users WHERE id=$1", [request.authenticatedUser!.id]);
        if (!account.rows[0]?.email) return reply.code(400).send({ error: "Add an email address to your account before enabling email notifications." });
      }
      await pool!.query(
        `INSERT INTO module_notification_preferences (department_id,user_id,event_reminders_enabled,service_requests_enabled,follow_ups_enabled,email_notifications_enabled)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (department_id,user_id) DO UPDATE SET event_reminders_enabled=EXCLUDED.event_reminders_enabled,service_requests_enabled=EXCLUDED.service_requests_enabled,follow_ups_enabled=EXCLUDED.follow_ups_enabled,email_notifications_enabled=EXCLUDED.email_notifications_enabled,updated_at=now()`,
        [departmentId, request.authenticatedUser!.id, request.body.eventRemindersEnabled, request.body.serviceRequestsEnabled, request.body.followUpsEnabled, request.body.emailEnabled],
      );
      return { eventRemindersEnabled: request.body.eventRemindersEnabled, serviceRequestsEnabled: request.body.serviceRequestsEnabled, followUpsEnabled: request.body.followUpsEnabled, emailEnabled: request.body.emailEnabled };
    });

    routes.post<{ Body: { title: string; body: string; audience: "location" | "groups"; groupIds: string[] } }>("/api/modules/notifications/announcements", { schema: announcementSchema }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      if (request.activeDepartmentRole !== "site_admin") return reply.code(403).send({ error: "Only a site administrator can send a location announcement." });
      const title = request.body.title.trim();
      const body = request.body.body.trim();
      if (!title || !body) return reply.code(400).send({ error: "Enter a title and message." });
      const groupIds = [...new Set(request.body.groupIds)];
      if (request.body.audience === "groups" && groupIds.length === 0) return reply.code(400).send({ error: "Select at least one group." });
      let recipients;
      if (request.body.audience === "groups") {
        const groups = await pool!.query<{ id: string }>("SELECT id FROM church_groups WHERE department_id=$1 AND id=ANY($2::uuid[])", [departmentId, groupIds]);
        if (groups.rowCount !== groupIds.length) return reply.code(400).send({ error: "One or more selected groups are not in this location." });
        recipients = await pool!.query<{ user_id: string }>(
          `SELECT DISTINCT membership.user_id
             FROM church_groups selected
             JOIN group_members member ON member.group_id=selected.id AND member.status='active'
             JOIN contacts person ON person.id=member.contact_id AND person.department_id=selected.department_id
             JOIN department_memberships membership ON membership.department_id=selected.department_id AND membership.contact_id=person.id
            WHERE selected.department_id=$1 AND selected.id=ANY($2::uuid[])`,
          [departmentId, groupIds],
        );
      } else {
        recipients = await pool!.query<{ user_id: string }>("SELECT user_id FROM department_memberships WHERE department_id=$1", [departmentId]);
      }
      const client = await pool!.connect();
      let recipientCount = 0;
      try {
        await client.query("BEGIN");
        for (const recipient of recipients.rows) {
          await client.query(
            `INSERT INTO module_notifications (id, department_id, recipient_user_id, sender_user_id, kind, title, body)
             VALUES ($1, $2, $3, $4, 'announcement', $5, $6)`,
            [randomUUID(), departmentId, recipient.user_id, request.authenticatedUser!.id, title, body],
          );
          recipientCount += 1;
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
      return reply.code(201).send({ sent: true, recipientCount, audience: request.body.audience });
    });
  });
}
