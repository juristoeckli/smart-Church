import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool, PoolClient } from "pg";
import { isServerModuleEnabled, type ModuleServerContext } from "../module-sdk.js";

const kind = "calendar_new_appointments";
type Cadence = "daily" | "weekly";
type Subscription = { calendar_id: string; user_id: string; department_id: string };
const cadenceInterval = "CASE WHEN subscription.cadence='daily' THEN interval '24 hours' ELSE interval '168 hours' END";

export function registerCalendarEmailSubscriptions(app: FastifyInstance, context: ModuleServerContext) {
  app.get("/api/modules/church-calendar/email-subscriptions", async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return reply.code(503).send({ error: "Calendar storage is unavailable." });
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    reply.header("Cache-Control", "private, no-store");
    const userId = request.authenticatedUser?.id;
    if (!userId) return reply.code(401).send({ error: "Sign in to manage Calendar updates." });
    const enabled = isServerModuleEnabled("notifications");
    const result = await context.pool.query<{
      calendarId: string; calendarName: string | null; cadence: Cadence | null; eligible: boolean;
    }>(
      `SELECT calendar.id AS "calendarId",CASE WHEN access.eligible THEN calendar.name END AS "calendarName",subscription.cadence,access.eligible
         FROM church_calendar_calendars calendar
         LEFT JOIN church_calendar_email_subscriptions subscription
           ON subscription.calendar_id=calendar.id AND subscription.department_id=$1 AND subscription.user_id=$2
        CROSS JOIN LATERAL (SELECT ($3 AND church_calendar_can_receive_email($1,calendar.id,$2)) AS eligible) access
        WHERE calendar.department_id=$1 AND (subscription.calendar_id IS NOT NULL OR access.eligible)
        ORDER BY "calendarName" NULLS LAST,calendar.id`, [departmentId, userId, enabled],
    );
    // Users can stop their own stale subscriptions without seeing the old calendar name.
    return result.rows;
  });

  app.put<{ Params: { id: string }; Body: { cadence: Cadence | null } }>("/api/modules/church-calendar/calendars/:id/email-subscription", {
    schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["cadence"], properties: { cadence: { enum: ["daily", "weekly", null] } } },
    },
  }, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return reply.code(503).send({ error: "Calendar storage is unavailable." });
    if (!context.validateMutation(request, reply)) return reply;
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const userId = request.authenticatedUser?.id;
    if (!userId) return reply.code(401).send({ error: "Sign in to manage Calendar updates." });
    const calendarId = request.params.id;
    const cadence = request.body.cadence;
    const client = await context.pool.connect();
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "This location is read-only on this installation." });
      }
      if (!cadence) {
        await client.query("DELETE FROM church_calendar_email_subscriptions WHERE department_id=$1 AND calendar_id=$2 AND user_id=$3",
          [departmentId, calendarId, userId]);
      } else {
        const updated = isServerModuleEnabled("notifications") && await client.query(
          `INSERT INTO church_calendar_email_subscriptions(department_id,calendar_id,user_id,cadence,next_check_at)
           SELECT $1,$2,$3,$4,now() + CASE WHEN $4='daily' THEN interval '24 hours' ELSE interval '168 hours' END
            WHERE church_calendar_can_receive_email($1,$2,$3)
           ON CONFLICT (calendar_id,user_id) DO UPDATE SET cadence=EXCLUDED.cadence,
             next_check_at=CASE WHEN church_calendar_email_subscriptions.cadence=EXCLUDED.cadence
               THEN church_calendar_email_subscriptions.next_check_at ELSE EXCLUDED.next_check_at END
           WHERE church_calendar_email_subscriptions.department_id=$1`, [departmentId, calendarId, userId, cadence],
        );
        if (!updated || updated.rowCount !== 1) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "Calendar email updates are unavailable for this calendar." });
        }
      }
      await client.query("COMMIT");
      return { cadence };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  });
}

export async function queueCalendarEmailUpdates(pool: Pool, writableIds: string[], lockLocation: ModuleServerContext["lockDepartmentForWrite"]) {
  if (!writableIds.length) return;
  const installed = await pool.query<{ present: boolean }>("SELECT to_regclass('public.church_calendar_email_subscriptions') IS NOT NULL AS present");
  if (!installed.rows[0]?.present) return;
  const due = await pool.query<Subscription>(
    `SELECT calendar_id,user_id,department_id FROM church_calendar_email_subscriptions
      WHERE department_id=ANY($1::uuid[]) AND next_check_at<=now()
      ORDER BY next_check_at,calendar_id,user_id LIMIT 100`, [writableIds],
  );
  for (const item of due.rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (!await lockLocation(client, item.department_id)) { await client.query("ROLLBACK"); continue; }
      const selected = await client.query<{ can_queue: boolean }>(
        `SELECT (church_calendar_can_receive_email($1,$2,$3)
                 AND EXISTS (SELECT 1 FROM module_notification_preferences preference JOIN app_users account ON account.id=preference.user_id
                   WHERE preference.department_id=$1 AND preference.user_id=$3 AND preference.email_notifications_enabled
                     AND account.email IS NOT NULL AND NOT EXISTS (
                       SELECT 1 FROM module_notification_email_suppressions suppressed WHERE suppressed.email=lower(trim(account.email))
                     ))
                 AND EXISTS (SELECT 1 FROM church_calendar_appointments appointment
                   WHERE appointment.department_id=$1 AND appointment.calendar_id=$2 AND appointment.archived_at IS NULL
                     AND appointment.created_at>subscription.checked_through AND appointment.created_at<=now())) AS can_queue
           FROM church_calendar_email_subscriptions subscription
          WHERE subscription.department_id=$1 AND subscription.calendar_id=$2 AND subscription.user_id=$3
            AND subscription.next_check_at<=now() FOR UPDATE OF subscription SKIP LOCKED`,
        [item.department_id,item.calendar_id,item.user_id],
      );
      const row = selected.rows[0];
      if (!row) { await client.query("COMMIT"); continue; }
      if (row.can_queue) {
        const noticeId = randomUUID();
        await client.query(
          `INSERT INTO module_notifications(id,department_id,recipient_user_id,kind,title,body,in_app_enabled,email_enabled)
           VALUES($1,$2,$3,$4,'New Calendar appointments',
                  'A calendar you follow has new appointments. Sign in to Smart-Church to see your calendar.',false,true)`,
          [noticeId,item.department_id,item.user_id,kind],
        );
        await client.query(
          `UPDATE church_calendar_email_subscriptions subscription
              SET notice_id=$4,notice_since=checked_through,checked_through=now(),next_check_at=now()+${cadenceInterval}
            WHERE department_id=$1 AND calendar_id=$2 AND user_id=$3`,
          [item.department_id,item.calendar_id,item.user_id,noticeId],
        );
      } else {
        await client.query(
          `UPDATE church_calendar_email_subscriptions subscription
              SET checked_through=now(),next_check_at=now()+${cadenceInterval},
                  notice_id=NULL,notice_since=NULL
            WHERE department_id=$1 AND calendar_id=$2 AND user_id=$3`,
          [item.department_id,item.calendar_id,item.user_id],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}

export async function canDeliverCalendarEmail(client: Pick<PoolClient, "query">,
  noticeId: string, departmentId: string, userId: string, queuedEmail: string) {
  if (!isServerModuleEnabled("church-calendar")) return false;
  const installed = await client.query<{ present: boolean }>("SELECT to_regclass('public.church_calendar_email_subscriptions') IS NOT NULL AS present");
  if (!installed.rows[0]?.present) return false;
  const eligible = await client.query(
    `SELECT 1 FROM church_calendar_email_subscriptions subscription
      JOIN app_users account ON account.id=subscription.user_id
      JOIN module_notification_preferences preference ON preference.user_id=subscription.user_id AND preference.department_id=subscription.department_id
     WHERE subscription.notice_id=$1 AND subscription.department_id=$2 AND subscription.user_id=$3
       AND church_calendar_can_receive_email($2,subscription.calendar_id,$3)
       AND preference.email_notifications_enabled AND trim(account.email)=trim($4)
       AND EXISTS (SELECT 1 FROM church_calendar_appointments appointment
         WHERE appointment.department_id=$2 AND appointment.calendar_id=subscription.calendar_id AND appointment.archived_at IS NULL
           AND appointment.created_at>subscription.notice_since AND appointment.created_at<=subscription.checked_through)
       FOR SHARE OF subscription,account,preference`, [noticeId,departmentId,userId,queuedEmail],
  );
  return eligible.rowCount === 1;
}
