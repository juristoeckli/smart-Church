import { activeResourceBookingRequestNotice } from "../../resource-booking-notices.js";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { UserLanguage } from "@smart-church/contracts";
import { isServerModuleEnabled, type ModuleServerContext } from "../module-sdk.js";
import { deliverCalendarReminders } from "../../calendar-reminders.js";
import type { PoolClient } from "pg";
import { renderNotificationEmail, type NotificationEmailTemplate } from "./email-templates.js";
import { getAnnouncementAudienceCounts, getAnnouncementRecipientIds, type AnnouncementAudience } from "./announcement-audience.js";
import { getHomeDutyRequests } from "./home-duty-requests.js";
import { registerHomeWelcome } from "./home-welcome.js";
import { registerHomeLayout } from "./home-layout.js";

type NotificationRow = {
  id: string;
  kind: "announcement" | "event_reminder" | "service_request" | "follow_up_assignment" | "follow_up_reminder" | "community_feed" | "report_ready" | "resource_booking" | "resource_booking_request";
  title: string;
  body: string;
  event_id: string | null;
  related_contact_id: string | null;
  email_delivery_status: "pending" | "sent" | "delayed" | "delivered" | "bounced" | "complained" | "suppressed" | "failed" | "skipped" | null;
  created_at: Date | string;
  read_at: Date | string | null;
};

type PendingEmail = { notification_id: string; department_id: string; recipient_user_id: string; recipient_email: string; current_email: string | null; recipient_language: UserLanguage; email_enabled: boolean; notification_email_enabled: boolean; email_suppressed: boolean; personal_announcement: boolean; personal_recipient_current: boolean; title: string; body: string; template_subject: string | null; template_body: string | null; attempt_count: number };
type ResendWebhookPayload = { type?: string; data?: { email_id?: string; to?: string[]; [key: string]: unknown } };
type StoredResendEvent = { provider_event_id: string; event_type: string; provider_email_id: string };
type StoredWebhookEvent = { provider_event_id: string; event_type: string; provider_email_id: string; received_at: Date | string; processed_at: Date | string | null };

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
      audience: { type: "string", enum: ["location", "groups", "people"] },
      groupIds: { type: "array", maxItems: 100, uniqueItems: true, items: { type: "string", format: "uuid" } },
      personIds: { type: "array", maxItems: 100, uniqueItems: true, items: { type: "string", format: "uuid" } },
    },
  },
};

type Announcement = { title: string; body: string; audience: AnnouncementAudience; groupIds: string[]; personIds?: string[] };

const configurableEmailKinds = ["announcement", "event_reminder", "service_request", "follow_up_assignment", "follow_up_reminder", "community_feed"] as const;
const emailTemplatePlaceholders = new Set(["title", "body", "open_url"]);

function validateEmailTemplate(value: string, maxLength: number) {
  const cleaned = value.replace(/\u0000/g, "").slice(0, maxLength);
  const placeholders = cleaned.matchAll(/\{([^{}]+)\}/g);
  for (const match of placeholders) if (!emailTemplatePlaceholders.has(match[1]!)) return null;
  return cleaned;
}

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation } = context;
  let reminderTimer: ReturnType<typeof setInterval> | undefined;
  let reminderJobRunning = false;
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
    schemaVersion: "11",
    inspect: async (departmentId) => {
      if (!pool || !isDatabaseReady()) return { ready: false, blockers: ["Notifications database is unavailable."], recordCount: 0 };
      try {
        const result = await pool.query<{ notifications: string; preferences: string; dashboardPreferences: string; deliveries: string; webhookEvents: string; emailTemplates: string; announcementBatches: string; homeWelcome: string; homeLayout: string; emailEnabled: boolean }>(
          `SELECT (SELECT count(*) FROM module_notifications WHERE department_id=$1)::text notifications,
                  (SELECT count(*) FROM module_notification_preferences WHERE department_id=$1)::text preferences,
                  (SELECT count(*) FROM overview_widget_preferences WHERE department_id=$1)::text "dashboardPreferences",
                  (SELECT count(*) FROM module_notification_email_deliveries d JOIN module_notifications n ON n.id=d.notification_id WHERE n.department_id=$1)::text deliveries,
                  (SELECT count(*) FROM module_notification_webhook_events event JOIN module_notification_email_deliveries d ON d.provider_email_id=event.provider_email_id JOIN module_notifications n ON n.id=d.notification_id WHERE n.department_id=$1)::text "webhookEvents",
                  (SELECT count(*) FROM module_notification_email_templates WHERE department_id=$1)::text "emailTemplates",
                  (SELECT count(*) FROM module_notification_announcement_batches WHERE department_id=$1)::text "announcementBatches",
                  (SELECT count(*) FROM overview_location_welcome WHERE department_id=$1)::text "homeWelcome",
                  (SELECT count(*) FROM overview_location_layouts WHERE department_id=$1)::text "homeLayout",
                  EXISTS(SELECT 1 FROM module_notification_preferences WHERE department_id=$1 AND email_notifications_enabled) "emailEnabled"`, [departmentId]);
        const row = result.rows[0];
        const blockers: string[] = [];
        const ready = !row.emailEnabled || await context.email.isConfigured(departmentId);
        if (!ready) blockers.push("Email notifications are enabled for this site but the email connector is not configured on this server.");
        return { ready: !blockers.length, blockers, recordCount: Number(row.notifications) + Number(row.preferences) + Number(row.dashboardPreferences) + Number(row.deliveries) + Number(row.webhookEvents) + Number(row.emailTemplates) + Number(row.announcementBatches) + Number(row.homeWelcome) + Number(row.homeLayout) };
      } catch {
        return { ready: false, blockers: ["Notifications storage is not initialized on this server."], recordCount: 0 };
      }
    },
    exportSnapshot: async (client: PoolClient, departmentId) => {
      const notifications = await client.query("SELECT id,recipient_user_id,sender_user_id,kind,title,body,event_id,related_event_id,related_contact_id,in_app_enabled,email_enabled,created_at,read_at,announcement_batch_id,related_swap_id,swap_notice_state,resource_request_booking_ids FROM module_notifications WHERE department_id=$1 ORDER BY created_at,id", [departmentId]);
      const preferences = await client.query("SELECT user_id,event_reminders_enabled,service_requests_enabled,follow_ups_enabled,email_notifications_enabled,updated_at FROM module_notification_preferences WHERE department_id=$1 ORDER BY user_id", [departmentId]);
      const homeWidgetPreferences = await client.query("SELECT user_id,widget_order,visible_widgets,updated_at FROM overview_widget_preferences WHERE department_id=$1 ORDER BY user_id", [departmentId]);
      const deliveries = await client.query("SELECT d.notification_id,d.recipient_email,d.provider_email_id,d.status,d.attempt_count,d.next_attempt_at,d.last_error,d.sent_at,d.created_at,d.updated_at FROM module_notification_email_deliveries d JOIN module_notifications n ON n.id=d.notification_id WHERE n.department_id=$1 ORDER BY d.notification_id", [departmentId]);
      const suppressions = await client.query("SELECT email,reason,provider_event_id,created_at FROM module_notification_email_suppressions ORDER BY email");
      const webhookEvents = await client.query("SELECT event.provider_event_id,event.event_type,event.provider_email_id,event.received_at,event.processed_at FROM module_notification_webhook_events event WHERE event.provider_email_id IN (SELECT delivery.provider_email_id FROM module_notification_email_deliveries delivery JOIN module_notifications notification ON notification.id=delivery.notification_id WHERE notification.department_id=$1 AND delivery.provider_email_id IS NOT NULL) ORDER BY event.provider_event_id", [departmentId]);
      const emailTemplates = await client.query("SELECT kind,subject_template,body_template,updated_by,updated_at FROM module_notification_email_templates WHERE department_id=$1 ORDER BY kind", [departmentId]);
      const announcementBatches = await client.query("SELECT id,sent_at,sender_name,title,audience,group_names,recipient_count,email_queued_count FROM module_notification_announcement_batches WHERE department_id=$1 ORDER BY sent_at,id", [departmentId]);
      const homeWelcome = await client.query("SELECT heading,subtitle FROM overview_location_welcome WHERE department_id=$1", [departmentId]);
      const homeLayout = await client.query("SELECT widget_order,visible_widgets FROM overview_location_layouts WHERE department_id=$1", [departmentId]);
      return { version: 10, homeLayout: homeLayout.rows, homeWelcome: homeWelcome.rows, announcementBatches: announcementBatches.rows, notifications: notifications.rows, preferences: preferences.rows, homeWidgetPreferences: homeWidgetPreferences.rows, deliveries: deliveries.rows, suppressions: suppressions.rows, webhookEvents: webhookEvents.rows, emailTemplates: emailTemplates.rows };
    },
    restoreSnapshot: async (client: PoolClient, departmentId, input, restoreContext) => {
      const snapshot = input as { version?: unknown; notifications?: Array<Record<string, unknown>>; preferences?: Array<Record<string, unknown>>; homeWidgetPreferences?: Array<Record<string, unknown>>; deliveries?: Array<Record<string, unknown>>; suppressions?: Array<Record<string, unknown>>; webhookEvents?: Array<Record<string, unknown>>; emailTemplates?: Array<Record<string, unknown>>; announcementBatches?: Array<Record<string, unknown>>; homeWelcome?: Array<Record<string, unknown>>; homeLayout?: Array<Record<string, unknown>> };
      if (!snapshot || ![2, 3, 4, 5, 6, 7, 8, 9, 10].includes(Number(snapshot.version)) || !Array.isArray(snapshot.notifications) || snapshot.notifications.length > 250000 || !Array.isArray(snapshot.preferences) || snapshot.preferences.length > 250000 || (Number(snapshot.version) >= 4 && (!Array.isArray(snapshot.homeWidgetPreferences) || snapshot.homeWidgetPreferences.length > 250000)) || !Array.isArray(snapshot.deliveries) || snapshot.deliveries.length > 250000 || !Array.isArray(snapshot.suppressions) || snapshot.suppressions.length > 250000 || !Array.isArray(snapshot.webhookEvents) || snapshot.webhookEvents.length > 250000 || (Number(snapshot.version) >= 5 && (!Array.isArray(snapshot.emailTemplates) || snapshot.emailTemplates.length > 100)) || (Number(snapshot.version) >= 6 && (!Array.isArray(snapshot.announcementBatches) || snapshot.announcementBatches.length > 250000)) || (Number(snapshot.version) >= 7 && (!Array.isArray(snapshot.homeWelcome) || snapshot.homeWelcome.length > 1)) || (Number(snapshot.version) >= 8 && (!Array.isArray(snapshot.homeLayout) || snapshot.homeLayout.length > 1))) throw new Error("The Notifications snapshot is invalid or exceeds supported limits.");
      await client.query("DELETE FROM module_notification_webhook_events WHERE provider_email_id IN (SELECT d.provider_email_id FROM module_notification_email_deliveries d JOIN module_notifications n ON n.id=d.notification_id WHERE n.department_id=$1 AND d.provider_email_id IS NOT NULL)", [departmentId]);
      await client.query("DELETE FROM module_notification_preferences WHERE department_id=$1", [departmentId]);
      await client.query("DELETE FROM overview_widget_preferences WHERE department_id=$1", [departmentId]);
      await client.query("DELETE FROM overview_location_layouts WHERE department_id=$1", [departmentId]);
      for (const row of snapshot.homeLayout ?? []) {
        await client.query("INSERT INTO overview_location_layouts(department_id,widget_order,visible_widgets) VALUES($1,$2::jsonb,$3::jsonb)", [departmentId,JSON.stringify(row.widget_order),JSON.stringify(row.visible_widgets)]);
      }
      await client.query("DELETE FROM overview_location_welcome WHERE department_id=$1", [departmentId]);
      for (const row of snapshot.homeWelcome ?? []) {
        await client.query("INSERT INTO overview_location_welcome(department_id,heading,subtitle) VALUES($1,$2,$3)", [departmentId,row.heading,row.subtitle]);
      }
      await client.query("DELETE FROM module_notification_email_templates WHERE department_id=$1", [departmentId]);
      await client.query("DELETE FROM module_notifications WHERE department_id=$1", [departmentId]);
      await client.query("DELETE FROM module_notification_announcement_batches WHERE department_id=$1", [departmentId]);
      for (const batch of snapshot.announcementBatches ?? []) {
        await client.query(`INSERT INTO module_notification_announcement_batches (department_id,id,sent_at,sender_name,title,audience,group_names,recipient_count,email_queued_count)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [departmentId,batch.id,batch.sent_at,batch.sender_name,batch.title,batch.audience,batch.group_names,batch.recipient_count,batch.email_queued_count]);
      }
      for (const row of snapshot.notifications) {
        const recipientId = restoreContext.userIdMap.get(String(row.recipient_user_id));
        const senderId = row.sender_user_id == null ? null : restoreContext.userIdMap.get(String(row.sender_user_id)) ?? null;
        if (!recipientId) throw new Error("A notification recipient has no matching account on the standby server.");
        await client.query("INSERT INTO module_notifications(id,department_id,recipient_user_id,sender_user_id,kind,title,body,event_id,related_event_id,related_contact_id,in_app_enabled,email_enabled,created_at,read_at,announcement_batch_id,related_swap_id,swap_notice_state,resource_request_booking_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)", [row.id, departmentId, recipientId, senderId, row.kind, row.title, row.body, row.event_id, row.related_event_id, row.related_contact_id, row.in_app_enabled ?? true, row.email_enabled ?? true, row.created_at, row.read_at, row.announcement_batch_id ?? null, row.related_swap_id ?? null, row.swap_notice_state ?? null, row.resource_request_booking_ids ?? null]);
      }
      for (const row of snapshot.preferences) {
        const userId = restoreContext.userIdMap.get(String(row.user_id));
        if (!userId) throw new Error("A notification preference has no matching account on the standby server.");
        await client.query("INSERT INTO module_notification_preferences(department_id,user_id,event_reminders_enabled,service_requests_enabled,follow_ups_enabled,email_notifications_enabled,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [departmentId, userId, row.event_reminders_enabled, row.service_requests_enabled, row.follow_ups_enabled, row.email_notifications_enabled, row.updated_at]);
      }
      for (const row of snapshot.homeWidgetPreferences ?? []) {
        const userId = restoreContext.userIdMap.get(String(row.user_id));
        if (!userId) throw new Error("A home widget preference has no matching account on the standby server.");
        await client.query("INSERT INTO overview_widget_preferences(department_id,user_id,widget_order,visible_widgets,updated_at) VALUES($1,$2,$3::jsonb,$4::jsonb,$5)", [departmentId, userId, JSON.stringify(row.widget_order), JSON.stringify(row.visible_widgets), row.updated_at]);
      }
      for (const row of snapshot.emailTemplates ?? []) await client.query("INSERT INTO module_notification_email_templates(department_id,kind,subject_template,body_template,updated_by,updated_at) VALUES($1,$2,$3,$4,$5,$6)", [departmentId, row.kind, row.subject_template, row.body_template, row.updated_by == null ? null : restoreContext.userIdMap.get(String(row.updated_by)) ?? null, row.updated_at]);
      for (const row of snapshot.deliveries) await client.query("INSERT INTO module_notification_email_deliveries(notification_id,recipient_email,provider_email_id,status,attempt_count,next_attempt_at,last_error,sent_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(notification_id) DO UPDATE SET recipient_email=EXCLUDED.recipient_email,provider_email_id=EXCLUDED.provider_email_id,status=EXCLUDED.status,attempt_count=EXCLUDED.attempt_count,next_attempt_at=EXCLUDED.next_attempt_at,last_error=EXCLUDED.last_error,sent_at=EXCLUDED.sent_at,updated_at=EXCLUDED.updated_at", [row.notification_id, row.recipient_email, row.provider_email_id, row.status, row.attempt_count, row.next_attempt_at, row.last_error, row.sent_at, row.created_at, row.updated_at]);
      // Suppressions are installation-wide by design. Merge them during a
      // per-location restore so syncing one location never removes entries
      // created by another location on this server.
      for (const row of snapshot.suppressions) await client.query(`INSERT INTO module_notification_email_suppressions(email,reason,provider_event_id,created_at)
        VALUES($1,$2,$3,$4)
        ON CONFLICT(email) DO UPDATE SET
          reason=CASE WHEN module_notification_email_suppressions.reason='email.complained' THEN module_notification_email_suppressions.reason ELSE EXCLUDED.reason END,
          provider_event_id=EXCLUDED.provider_event_id,
          created_at=LEAST(module_notification_email_suppressions.created_at,EXCLUDED.created_at)`, [row.email, row.reason, row.provider_event_id, row.created_at]);
      for (const row of snapshot.webhookEvents) await client.query("INSERT INTO module_notification_webhook_events(provider_event_id,event_type,provider_email_id,received_at,processed_at) VALUES($1,$2,$3,$4,$5)", [row.provider_event_id,row.event_type,row.provider_email_id,row.received_at,row.processed_at]);
      return { recordCount: snapshot.notifications.length + snapshot.preferences.length + (snapshot.homeWidgetPreferences?.length ?? 0) + (snapshot.emailTemplates?.length ?? 0) + snapshot.deliveries.length + snapshot.webhookEvents.length + (snapshot.announcementBatches?.length ?? 0) + (snapshot.homeWelcome?.length ?? 0) + (snapshot.homeLayout?.length ?? 0) };
    },
    verifySnapshot: async (client: PoolClient, departmentId, input, restoreContext) => {
      const snapshot = input as { version?: unknown; notifications?: Array<Record<string, unknown>>; preferences?: Array<Record<string, unknown>>; homeWidgetPreferences?: Array<Record<string, unknown>>; deliveries?: Array<Record<string, unknown>>; suppressions?: Array<Record<string, unknown>>; webhookEvents?: Array<Record<string, unknown>>; emailTemplates?: Array<Record<string, unknown>>; announcementBatches?: Array<Record<string, unknown>>; homeWelcome?: Array<Record<string, unknown>>; homeLayout?: Array<Record<string, unknown>> };
      if (!snapshot || ![2, 3, 4, 5, 6, 7, 8, 9, 10].includes(Number(snapshot.version)) || !Array.isArray(snapshot.notifications) || !Array.isArray(snapshot.preferences) || (Number(snapshot.version) >= 4 && !Array.isArray(snapshot.homeWidgetPreferences)) || !Array.isArray(snapshot.deliveries) || !Array.isArray(snapshot.suppressions) || !Array.isArray(snapshot.webhookEvents) || (Number(snapshot.version) >= 5 && !Array.isArray(snapshot.emailTemplates)) || (Number(snapshot.version) >= 6 && !Array.isArray(snapshot.announcementBatches)) || (Number(snapshot.version) >= 7 && (!Array.isArray(snapshot.homeWelcome) || snapshot.homeWelcome.length > 1)) || (Number(snapshot.version) >= 8 && (!Array.isArray(snapshot.homeLayout) || snapshot.homeLayout.length > 1))) return { ready: false, blockers: ["No verified Notifications snapshot is available."] };
      const actualNotifications = (await client.query("SELECT id,recipient_user_id,sender_user_id,kind,title,body,event_id,related_event_id,related_contact_id,in_app_enabled,email_enabled,created_at,read_at,announcement_batch_id,related_swap_id,swap_notice_state,resource_request_booking_ids FROM module_notifications WHERE department_id=$1 ORDER BY created_at,id", [departmentId])).rows as Array<Record<string, unknown>>;
      const actualPreferences = (await client.query("SELECT user_id,event_reminders_enabled,service_requests_enabled,follow_ups_enabled,email_notifications_enabled,updated_at FROM module_notification_preferences WHERE department_id=$1 ORDER BY user_id", [departmentId])).rows as Array<Record<string, unknown>>;
      const actualHomeWidgetPreferences = (await client.query("SELECT user_id,widget_order,visible_widgets,updated_at FROM overview_widget_preferences WHERE department_id=$1 ORDER BY user_id", [departmentId])).rows as Array<Record<string, unknown>>;
      const actualEmailTemplates = (await client.query("SELECT kind,subject_template,body_template,updated_by,updated_at FROM module_notification_email_templates WHERE department_id=$1 ORDER BY kind", [departmentId])).rows as Array<Record<string, unknown>>;
      const actualDeliveries = (await client.query("SELECT d.notification_id,d.recipient_email,d.provider_email_id,d.status,d.attempt_count,d.next_attempt_at,d.last_error,d.sent_at,d.created_at,d.updated_at FROM module_notification_email_deliveries d JOIN module_notifications n ON n.id=d.notification_id WHERE n.department_id=$1 ORDER BY d.notification_id", [departmentId])).rows as Array<Record<string, unknown>>;
      const actualWebhookEvents = (await client.query("SELECT event.provider_event_id,event.event_type,event.provider_email_id,event.received_at,event.processed_at FROM module_notification_webhook_events event WHERE event.provider_email_id IN (SELECT delivery.provider_email_id FROM module_notification_email_deliveries delivery JOIN module_notifications notification ON notification.id=delivery.notification_id WHERE notification.department_id=$1 AND delivery.provider_email_id IS NOT NULL) ORDER BY event.provider_event_id", [departmentId])).rows as Array<Record<string, unknown>>;
      const actualAnnouncementBatches = (await client.query("SELECT id,sent_at,sender_name,title,audience,group_names,recipient_count,email_queued_count FROM module_notification_announcement_batches WHERE department_id=$1 ORDER BY sent_at,id", [departmentId])).rows as Array<Record<string, unknown>>;
      const actualHomeWelcome = (await client.query("SELECT heading,subtitle FROM overview_location_welcome WHERE department_id=$1", [departmentId])).rows as Array<Record<string, unknown>>;
      const actualHomeLayout = (await client.query("SELECT widget_order,visible_widgets FROM overview_location_layouts WHERE department_id=$1", [departmentId])).rows as Array<Record<string, unknown>>;
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
      if (Number(snapshot.version) < 3) for (const row of snapshot.notifications) { row.in_app_enabled ??= true; row.email_enabled ??= true; }
      const expectedNotifications = remap(snapshot.notifications, ["recipient_user_id", "sender_user_id"])
        .map((row) => ({ ...row, announcement_batch_id: row.announcement_batch_id ?? null, related_swap_id: row.related_swap_id ?? null, swap_notice_state: row.swap_notice_state ?? null, resource_request_booking_ids: row.resource_request_booking_ids ?? null }));
      if (!same(expectedNotifications, actualNotifications)
        || !same(snapshot.announcementBatches ?? [], actualAnnouncementBatches)
        || !same(snapshot.homeWelcome ?? [], actualHomeWelcome)
        || !same(snapshot.homeLayout ?? [], actualHomeLayout)
        || !same(remap(snapshot.preferences, ["user_id"]), actualPreferences)
        || !same(remap(snapshot.homeWidgetPreferences ?? [], ["user_id"]), actualHomeWidgetPreferences)
        || (Number(snapshot.version) >= 5 && !same(remap(snapshot.emailTemplates ?? [], ["updated_by"]), actualEmailTemplates))
        || !same(snapshot.deliveries, actualDeliveries)
        || !same(snapshot.webhookEvents, actualWebhookEvents)) return { ready: false, blockers: ["Notification, email delivery, or webhook records differ from the source snapshot after restore."] };
      const actualSuppressions = (await client.query("SELECT email,reason,provider_event_id,created_at FROM module_notification_email_suppressions ORDER BY email")).rows as Array<Record<string, unknown>>;
      const actualSuppressionByEmail = new Map(actualSuppressions.map((row) => [String(row.email), row]));
      const suppressionStrength = (reason: unknown) => reason === "email.complained" ? 2 : ["email.bounced", "email.suppressed"].includes(String(reason)) ? 1 : 0;
      if (snapshot.suppressions.some((row) => {
        const actual = actualSuppressionByEmail.get(String(row.email));
        if (!actual) return true;
        // A stronger suppression from another location satisfies the source
        // entry; provider event IDs and timestamps may legitimately differ.
        return suppressionStrength(actual.reason) < suppressionStrength(row.reason);
      })) return { ready: false, blockers: ["Email bounce suppressions from the source are missing or weaker on the standby."] };
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
          AND e.cancelled_at IS NULL
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
          AND e.cancelled_at IS NULL
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
          AND e.cancelled_at IS NULL
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
          AND e.cancelled_at IS NULL
          AND e.department_id = ANY($1::uuid[])
          AND ((e.event_date+e.start_time) AT TIME ZONE d.time_zone) < now()+interval '30 days'
          AND COALESCE(preference.service_requests_enabled,true)
        GROUP BY e.department_id,m.user_id,e.id,e.title,e.event_date,e.start_time,e.room
       ON CONFLICT DO NOTHING`, [writableIds],
    );
  }

  async function deliverPendingEmails() {
    if (!pool || !isDatabaseReady()) return;
    const writableIds = await writableDepartmentIds();
    if (!writableIds.length) return;
    const configuredIds: string[] = [];
    for (const departmentId of writableIds) if (await context.email.isConfigured(departmentId)) configuredIds.push(departmentId);
    if (!configuredIds.length) return;
    for (let sent = 0; sent < 20; sent += 1) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query<PendingEmail>(
          `SELECT delivery.notification_id,notification.department_id,notification.recipient_user_id,delivery.recipient_email,account.email AS current_email,account.language AS recipient_language,
                  (COALESCE(preference.email_notifications_enabled,false)
                   AND (notification.kind<>'service_request' OR COALESCE(preference.service_requests_enabled,true))
                   AND ${activeResourceBookingRequestNotice}
                   AND (notification.kind<>'resource_booking' OR (account.is_enabled AND NOT account.is_service_user AND EXISTS (
                     SELECT 1 FROM department_memberships member
                     WHERE member.department_id=notification.department_id AND member.user_id=notification.recipient_user_id
                   )))
                   AND (notification.related_swap_id IS NULL OR EXISTS (
                     SELECT 1 FROM event_position_swap_requests swap
                     JOIN department_memberships member ON member.department_id=notification.department_id AND member.user_id=notification.recipient_user_id
                     JOIN contacts person ON person.id=member.contact_id AND person.department_id=member.department_id AND person.archived_at IS NULL
                     WHERE swap.id=notification.related_swap_id AND swap.event_id=notification.related_event_id
                       AND swap.status=notification.swap_notice_state AND account.is_enabled AND NOT account.is_service_user
                       AND person.id=CASE WHEN swap.status IN ('pending','cancelled') THEN swap.target_contact_id ELSE swap.requester_contact_id END
                   ))) AS email_enabled,
                  notification.email_enabled AS notification_email_enabled,
                  (suppressed.email IS NOT NULL) AS email_suppressed,
                  COALESCE(batch.audience='people',false) AS personal_announcement,
                  (account.is_enabled AND NOT account.is_service_user AND trim(account.email)=trim(delivery.recipient_email) AND EXISTS (
                    SELECT 1 FROM department_memberships m JOIN contacts c ON c.id=m.contact_id AND c.department_id=m.department_id
                     WHERE m.department_id=notification.department_id AND m.user_id=notification.recipient_user_id
                       AND c.id=notification.related_contact_id AND c.archived_at IS NULL
                  )) AS personal_recipient_current,
                   notification.title,notification.body,template.subject_template,template.body_template,delivery.attempt_count
             FROM module_notification_email_deliveries delivery
             JOIN module_notifications notification ON notification.id=delivery.notification_id
             JOIN app_users account ON account.id=notification.recipient_user_id
             LEFT JOIN module_notification_announcement_batches batch ON batch.id=notification.announcement_batch_id AND batch.department_id=notification.department_id
             LEFT JOIN module_notification_preferences preference ON preference.department_id=notification.department_id AND preference.user_id=notification.recipient_user_id
             LEFT JOIN module_notification_email_suppressions suppressed ON suppressed.email=lower(trim(account.email))
              LEFT JOIN module_notification_email_templates template ON template.department_id=notification.department_id AND template.kind=notification.kind
            WHERE notification.department_id = ANY($1::uuid[]) AND delivery.status IN ('pending','failed') AND delivery.attempt_count < 8 AND delivery.next_attempt_at <= now()
            ORDER BY delivery.created_at
            LIMIT 1 FOR UPDATE OF delivery SKIP LOCKED`, [configuredIds],
        );
        if (!result.rowCount) { await client.query("COMMIT"); break; }
        const delivery = result.rows[0];
        if (delivery.personal_announcement && !await context.lockDepartmentForWrite(client, delivery.department_id)) {
          await client.query("ROLLBACK");
          break;
        }
        if (!delivery.email_enabled || !delivery.notification_email_enabled || !delivery.current_email || delivery.email_suppressed
            || (delivery.personal_announcement && !delivery.personal_recipient_current)) {
          await client.query("UPDATE module_notification_email_deliveries SET status='skipped',last_error=CASE WHEN $2 THEN 'Address suppressed after a bounce or complaint.' ELSE NULL END,updated_at=now() WHERE notification_id=$1", [delivery.notification_id, delivery.email_suppressed]);
          await client.query("COMMIT");
          continue;
        }
        const attempts = delivery.attempt_count + 1;
        try {
          const emailContent = renderNotificationEmail(delivery.title, delivery.body, process.env.SMART_CHURCH_WEB_ORIGIN, delivery.recipient_language, { subjectTemplate: delivery.template_subject, bodyTemplate: delivery.template_body });
          const recipient = delivery.personal_announcement ? { recipientEmail: delivery.recipient_email.trim() } : { recipientUserId: delivery.recipient_user_id };
          const sent = await context.email.send({ ...recipient, ...emailContent }, delivery.department_id);
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

  async function runReminderJobs() {
    if (reminderJobRunning || !storageReady) return;
    reminderJobRunning = true;
    try {
      await createUpcomingReminders();
      if (pool && isServerModuleEnabled("church-calendar")) {
        try {
          await deliverCalendarReminders(pool, await writableDepartmentIds(), context.lockDepartmentForWrite);
        } catch (error) { app.log.error({ err: error }, "Could not deliver Calendar reminders."); }
      }
      await deliverPendingEmails();
      await processPendingWebhookEvents();
    } finally {
      reminderJobRunning = false;
    }
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
          kind TEXT NOT NULL CHECK (kind IN ('announcement', 'event_reminder', 'service_request', 'follow_up_assignment', 'follow_up_reminder', 'community_feed', 'report_ready', 'resource_booking', 'resource_booking_request')),
          title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
          body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
          event_id UUID REFERENCES service_events(id) ON DELETE CASCADE,
          related_event_id UUID REFERENCES service_events(id) ON DELETE CASCADE,
          related_contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
          in_app_enabled BOOLEAN NOT NULL DEFAULT true,
          email_enabled BOOLEAN NOT NULL DEFAULT true,
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
        CREATE TABLE IF NOT EXISTS module_notification_email_templates (
          department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('announcement','event_reminder','service_request','follow_up_assignment','follow_up_reminder','community_feed')),
          subject_template TEXT,
          body_template TEXT,
          updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (department_id,kind),
          CHECK (subject_template IS NULL OR char_length(subject_template)<=240),
          CHECK (body_template IS NULL OR char_length(body_template)<=4000)
        );
        ALTER TABLE module_notifications DROP CONSTRAINT IF EXISTS module_notifications_kind_check;
        ALTER TABLE module_notifications ADD COLUMN IF NOT EXISTS related_contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE;
        ALTER TABLE module_notifications ADD COLUMN IF NOT EXISTS related_event_id UUID REFERENCES service_events(id) ON DELETE CASCADE;
        ALTER TABLE module_notifications ADD COLUMN IF NOT EXISTS in_app_enabled BOOLEAN NOT NULL DEFAULT true;
        ALTER TABLE module_notifications ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN NOT NULL DEFAULT true;
        ALTER TABLE module_notifications ADD COLUMN IF NOT EXISTS announcement_batch_id UUID;
        ALTER TABLE module_notifications ADD COLUMN IF NOT EXISTS related_swap_id UUID REFERENCES event_position_swap_requests(id) ON DELETE CASCADE;
        ALTER TABLE module_notifications ADD COLUMN IF NOT EXISTS resource_request_booking_ids UUID[];
        ALTER TABLE module_notifications ADD COLUMN IF NOT EXISTS swap_notice_state TEXT CHECK (swap_notice_state IN ('pending','accepted','declined','cancelled'));
        DO $$
        BEGIN
          ALTER TABLE module_notifications ADD CONSTRAINT module_notifications_announcement_batch_fk
            FOREIGN KEY (department_id, announcement_batch_id) REFERENCES module_notification_announcement_batches(department_id,id);
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
        CREATE INDEX IF NOT EXISTS idx_module_notifications_announcement_batch
          ON module_notifications (department_id, announcement_batch_id) WHERE announcement_batch_id IS NOT NULL;
        ALTER TABLE module_notifications ADD CONSTRAINT module_notifications_kind_check CHECK (kind IN ('announcement','event_reminder','service_request','follow_up_assignment','follow_up_reminder','community_feed','report_ready','resource_booking','resource_booking_request'));
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
           WHERE account.id=NEW.recipient_user_id AND account.email IS NOT NULL AND preference.email_notifications_enabled=true AND NEW.email_enabled=true
             AND NOT EXISTS (SELECT 1 FROM module_notification_email_suppressions suppressed WHERE suppressed.email=lower(trim(account.email)))
          ON CONFLICT (notification_id) DO NOTHING;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        DROP TRIGGER IF EXISTS module_notifications_queue_email ON module_notifications;
        CREATE TRIGGER module_notifications_queue_email AFTER INSERT ON module_notifications
          FOR EACH ROW EXECUTE FUNCTION queue_module_notification_email();
      `);
        storageReady = true;
        await runReminderJobs();
        reminderTimer = setInterval(() => { void runReminderJobs().catch((error) => routes.log.error({ err: error }, "Could not process notification jobs.")); }, 60_000);
        reminderTimer.unref?.();
      } catch (error) {
        storageReady = false;
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

    registerHomeWelcome(routes, { getPool: () => pool!, department, validateMutation, lockDepartmentForWrite: context.lockDepartmentForWrite });

    routes.get("/api/modules/notifications/home-duty-requests", async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const result = await getHomeDutyRequests(pool!, departmentId, request.authenticatedUser!.id);
      return reply.header("Cache-Control", "private, no-store").send(result);
    });

    registerHomeLayout(routes, { getPool: () => pool!, department, validateMutation, lockDepartmentForWrite: context.lockDepartmentForWrite });

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
          WHERE notification.department_id = $1 AND notification.recipient_user_id = $2 AND notification.in_app_enabled=true
            AND ${activeResourceBookingRequestNotice}
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
        emailDeliveryConfigured: await context.email.isConfigured(departmentId),
        emailSuppressed: Boolean(suppression.rowCount),
        canSend: request.activeDepartmentRole === "site_admin",
      };
    });

    routes.get("/api/modules/notifications/email-templates", async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      if (request.activeDepartmentRole !== "site_admin") return reply.code(403).send({ error: "Only a site administrator can manage notification email templates." });
      const result = await pool!.query<{ kind: typeof configurableEmailKinds[number]; subject_template: string | null; body_template: string | null; updated_at: Date | string | null }>(
        "SELECT kind,subject_template,body_template,updated_at FROM module_notification_email_templates WHERE department_id=$1 ORDER BY kind", [departmentId],
      );
      const byKind = new Map(result.rows.map((row) => [row.kind, row]));
      return { placeholders: [...emailTemplatePlaceholders], templates: configurableEmailKinds.map((kind) => {
        const row = byKind.get(kind);
        return { kind, subjectTemplate: row?.subject_template ?? "", bodyTemplate: row?.body_template ?? "", updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null };
      }) };
    });

    routes.put<{ Params: { kind: typeof configurableEmailKinds[number] }; Body: { subjectTemplate: string; bodyTemplate: string } }>("/api/modules/notifications/email-templates/:kind", {
      schema: {
        params: { type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { type: "string", enum: [...configurableEmailKinds] } } },
        body: { type: "object", additionalProperties: false, required: ["subjectTemplate", "bodyTemplate"], properties: { subjectTemplate: { type: "string", maxLength: 240 }, bodyTemplate: { type: "string", maxLength: 4000 } } },
      },
    }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      if (request.activeDepartmentRole !== "site_admin") return reply.code(403).send({ error: "Only a site administrator can manage notification email templates." });
      const rawSubject = request.body.subjectTemplate.trim();
      const rawBody = request.body.bodyTemplate.trim();
      const subject = validateEmailTemplate(rawSubject, 240);
      const body = validateEmailTemplate(rawBody, 4000);
      if ((rawSubject && subject === null) || (rawBody && body === null)) return reply.code(400).send({ error: "Use only the supported placeholders: {title}, {body}, and {open_url}." });
      const result = await pool!.query(
        `INSERT INTO module_notification_email_templates(department_id,kind,subject_template,body_template,updated_by,updated_at)
         VALUES($1,$2,$3,$4,$5,now())
         ON CONFLICT(department_id,kind) DO UPDATE SET subject_template=EXCLUDED.subject_template,body_template=EXCLUDED.body_template,updated_by=EXCLUDED.updated_by,updated_at=now()
         RETURNING kind,subject_template AS "subjectTemplate",body_template AS "bodyTemplate",updated_at AS "updatedAt"`,
        [departmentId, request.params.kind, subject || null, body || null, request.authenticatedUser!.id],
      );
      return result.rows[0];
    });

    routes.post<{ Params: { id: string } }>("/api/modules/notifications/:id/read", {
      schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
    }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const result = await pool!.query(
        `UPDATE module_notifications SET read_at = COALESCE(read_at, now())
          WHERE id = $1 AND department_id = $2 AND recipient_user_id = $3 AND in_app_enabled=true RETURNING id`,
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
          WHERE department_id = $1 AND recipient_user_id = $2 AND in_app_enabled=true AND read_at IS NULL`,
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
      if (request.body.emailEnabled && !await context.email.isConfigured(departmentId)) {
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

    async function resolveAnnouncement(request: FastifyRequest<{ Body: Announcement }>, reply: FastifyReply) {
      if (!validateMutation(request, reply)) return null;
      const departmentId = await department(request, reply);
      if (!departmentId) return null;
      if (request.activeDepartmentRole !== "site_admin") {
        reply.code(403).send({ error: "Only a site administrator can send a location announcement." });
        return null;
      }
      const { audience } = request.body;
      const title = request.body.title.trim();
      const body = request.body.body.trim();
      if (!title || !body) {
        reply.code(400).send({ error: "Enter a title and message." });
        return null;
      }
      const groupIds = audience === "groups" ? [...new Set(request.body.groupIds.map((id) => id.toLowerCase()))] : [];
      const personIds = audience === "people" ? [...new Set((request.body.personIds ?? []).map((id) => id.toLowerCase()))] : [];
      if (audience === "groups") {
        if (!groupIds.length) {
          reply.code(400).send({ error: "Select at least one group." });
          return null;
        }
        const groups = await pool!.query<{ id: string }>("SELECT id FROM church_groups WHERE department_id=$1 AND id=ANY($2::uuid[])", [departmentId, groupIds]);
        if (groups.rowCount !== groupIds.length) {
          reply.code(400).send({ error: "One or more selected groups are not in this location." });
          return null;
        }
      }
      if (audience === "people") {
        if (!personIds.length) {
          reply.code(400).send({ error: "Select at least one person." });
          return null;
        }
        const people = await pool!.query("SELECT id FROM contacts WHERE department_id=$1 AND id=ANY($2::uuid[]) AND archived_at IS NULL",
          [departmentId, personIds]);
        if (people.rowCount !== personIds.length) {
          reply.code(400).send({ error: "One or more selected people are unavailable in this location." });
          return null;
        }
      }
      return { title, body, audience, departmentId, groupIds, personIds };
    }

    routes.get<{ Querystring: { q: string } }>("/api/modules/notifications/announcements/people", {
      schema: { querystring: { type: "object", required: ["q"], additionalProperties: false, properties: {
        q: { type: "string", minLength: 2, maxLength: 80 },
      } } },
    }, async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      if (request.activeDepartmentRole !== "site_admin" || request.headers.authorization) {
        return reply.code(403).send({ error: "A site administrator browser session is required to choose recipients." });
      }
      const search = request.query.q.trim();
      if (search.length < 2) return reply.code(400).send({ error: "Enter at least two characters to search." });
      const { rows } = await pool!.query(
        `SELECT person.id, concat_ws(' ', person.first_name, person.last_name) AS "displayName"
           FROM contacts person WHERE person.department_id=$1 AND person.archived_at IS NULL
            AND strpos(lower(concat_ws(' ', person.first_name, person.last_name)), lower($2)) > 0
            AND EXISTS (SELECT 1 FROM department_memberships admin JOIN app_users account ON account.id=admin.user_id
                         WHERE admin.department_id=person.department_id AND admin.user_id=$3 AND admin.role='site_admin'
                           AND account.is_enabled AND NOT account.is_service_user
                           AND NOT (account.must_change_password AND account.can_change_password))
          ORDER BY lower(person.last_name), lower(person.first_name), person.id LIMIT 31`,
        [departmentId, search, request.authenticatedUser!.id],
      );
      return reply.header("Cache-Control", "private, no-store").send({ people: rows.slice(0, 30), hasMore: rows.length > 30 });
    });

    routes.post<{ Body: Announcement }>("/api/modules/notifications/announcements/preview", { schema: announcementSchema }, async (request, reply) => {
      const announcement = await resolveAnnouncement(request, reply);
      if (!announcement) return reply;
      const { title, body, departmentId, audience, groupIds, personIds } = announcement;
      const [counts, templates, emailConfigured] = await Promise.all([
        getAnnouncementAudienceCounts(pool!, departmentId, audience, groupIds, personIds),
        pool!.query<NotificationEmailTemplate>(
          `SELECT subject_template AS "subjectTemplate", body_template AS "bodyTemplate"
             FROM module_notification_email_templates WHERE department_id=$1 AND kind='announcement'`, [departmentId],
        ),
        context.email.isConfigured(departmentId),
      ]);
      const { subject, text } = renderNotificationEmail(title, body, process.env.SMART_CHURCH_WEB_ORIGIN,
        request.authenticatedUser?.language ?? "en", templates.rows[0]);
      return reply.header("Cache-Control", "private, no-store").send({
        ...counts, emailConfigured, sampleEmail: { subject, text },
      });
    });

    routes.get<{ Querystring: { audience?: AnnouncementAudience; page?: number } }>("/api/modules/notifications/announcements/history", {
      schema: { querystring: { type: "object", additionalProperties: false, properties: {
        audience: { type: "string", enum: ["location", "groups", "people"] }, page: { type: "integer", minimum: 1, maximum: 2000 },
      } } },
    }, async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      if (request.activeDepartmentRole !== "site_admin" || request.headers.authorization) {
        return reply.code(403).send({ error: "A site administrator browser session is required to view announcement history." });
      }
      const page = request.query.page ?? 1;
      const pageSize = 25;
      const { rows } = await pool!.query(
        `WITH history AS (
           SELECT id, department_id, sent_at, sender_name, title, audience, group_names, recipient_count, email_queued_count
             FROM module_notification_announcement_batches batch
            WHERE batch.department_id=$1 AND ($2::text IS NULL OR batch.audience=$2)
              AND EXISTS (
                SELECT 1 FROM department_memberships member JOIN app_users account ON account.id=member.user_id
                 WHERE member.department_id=batch.department_id AND member.user_id=$3 AND member.role='site_admin'
                   AND account.is_enabled AND NOT account.is_service_user
                   AND NOT (account.must_change_password AND account.can_change_password)
              )
            ORDER BY batch.sent_at DESC, batch.id DESC LIMIT $4 OFFSET $5
         )
         SELECT history.id, history.sent_at AS "sentAt", history.sender_name AS "senderName", history.title,
                history.audience, history.group_names AS "groupNames", history.recipient_count AS "recipientCount",
                history.email_queued_count AS "emailQueuedCount", COALESCE((
                  SELECT jsonb_object_agg(status, amount) FROM (
                    SELECT d.status, count(*)::integer AS amount
                      FROM module_notifications n JOIN module_notification_email_deliveries d ON d.notification_id=n.id
                     WHERE n.department_id=history.department_id AND n.announcement_batch_id=history.id
                     GROUP BY d.status
                  ) totals
                ), '{}'::jsonb) AS "emailStatuses"
           FROM history ORDER BY history.sent_at DESC, history.id DESC`,
        [departmentId, request.query.audience ?? null, request.authenticatedUser!.id, pageSize + 1, (page - 1) * pageSize],
      );
      return reply.header("Cache-Control", "private, no-store").send({ page, hasNext: rows.length > pageSize && page < 2000, batches: rows.slice(0, pageSize) });
    });

    routes.post<{ Body: Announcement }>("/api/modules/notifications/announcements", { schema: announcementSchema }, async (request, reply) => {
      const announcement = await resolveAnnouncement(request, reply);
      if (!announcement) return reply;
      const { title, body, departmentId, audience, groupIds, personIds } = announcement;
      const personal = audience === "people";
      if (personal && !await context.email.isConfigured(departmentId)) {
        return reply.code(503).send({ error: "Email delivery is not configured for this location." });
      }
      const client = await pool!.connect();
      const batchId = randomUUID();
      let recipientCount = 0;
      let emailQueuedCount = 0;
      try {
        await client.query("BEGIN");
        if (!await context.lockDepartmentForWrite(client, departmentId)) {
          await client.query("ROLLBACK");
          return reply.code(423).send({ error: "This location is read-only." });
        }
        if (personal) {
          const sender = await client.query(
            `SELECT account.id FROM app_users account JOIN department_memberships membership ON membership.user_id=account.id
              WHERE account.id=$1 AND membership.department_id=$2 AND membership.role='site_admin'
                AND account.is_enabled AND NOT account.is_service_user AND NOT (account.must_change_password AND account.can_change_password)
              FOR SHARE OF account,membership`,
            [request.authenticatedUser!.id, departmentId],
          );
          if (!sender.rowCount || request.headers.authorization) {
            await client.query("ROLLBACK");
            return reply.code(403).send({ error: "A site administrator browser session is required to send this email." });
          }
        }
        const recipients = await getAnnouncementRecipientIds(client, departmentId, audience, groupIds, personIds);
        recipientCount = recipients.length;
        if (personal && !recipientCount) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "None of the selected people can currently receive this email." });
        }
        await client.query(
          `INSERT INTO module_notification_announcement_batches (id, department_id, sender_name, title, audience, group_names, recipient_count)
           VALUES ($1, $2, $3, $4, $5, ARRAY(SELECT name FROM church_groups WHERE department_id=$2 AND id=ANY($6::uuid[]) ORDER BY lower(name), id), $7)`,
          [batchId, departmentId, request.authenticatedUser!.displayName, title, audience, groupIds, recipientCount],
        );
        await client.query(
          `INSERT INTO module_notifications (id, department_id, recipient_user_id, sender_user_id, kind, title, body, announcement_batch_id, in_app_enabled, related_contact_id)
           SELECT gen_random_uuid(), $1, recipient, $2, 'announcement', $3, $4, $5
                  , NOT $8::boolean, CASE WHEN $8::boolean THEN person ELSE NULL END
             FROM unnest($6::uuid[], $7::uuid[]) AS selected(recipient, person)`,
          [departmentId, request.authenticatedUser!.id, title, body, batchId, recipients.map((recipient) => recipient.user_id), recipients.map((recipient) => recipient.contact_id), personal],
        );
        const { rows: [batch] } = await client.query<{ email_queued_count: number }>(
          `UPDATE module_notification_announcement_batches batch SET email_queued_count = (
             SELECT count(*)::integer FROM module_notifications n
             JOIN module_notification_email_deliveries d ON d.notification_id=n.id
             WHERE n.department_id=batch.department_id AND n.announcement_batch_id=batch.id
           ) WHERE batch.id=$1 AND batch.department_id=$2 RETURNING email_queued_count`,
          [batchId, departmentId],
        );
        emailQueuedCount = batch.email_queued_count;
        if (personal && !emailQueuedCount) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "None of the selected people can currently receive this email." });
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
      return reply.code(201).send({ sent: true, recipientCount, emailQueuedCount, audience, batchId });
    });
  });
}
