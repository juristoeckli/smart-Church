import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";

type NotificationRow = {
  id: string;
  kind: "announcement" | "event_reminder";
  title: string;
  body: string;
  event_id: string | null;
  created_at: Date | string;
  read_at: Date | string | null;
};

const announcementSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["title", "body"],
    properties: {
      title: { type: "string", minLength: 1, maxLength: 120 },
      body: { type: "string", minLength: 1, maxLength: 2000 },
    },
  },
};

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation } = context;
  let reminderTimer: ReturnType<typeof setInterval> | undefined;
  let storageReady = false;

  async function createUpcomingReminders() {
    if (!pool || !isDatabaseReady()) return;
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
          AND COALESCE(p.event_reminders_enabled, true)
       ON CONFLICT DO NOTHING`,
    );
  }

  app.register(async (routes) => {
    routes.addHook("onReady", async () => {
      if (!pool || !isDatabaseReady()) return;
      try {
        await pool.query(`
        CREATE TABLE IF NOT EXISTS module_notifications (
          id UUID PRIMARY KEY,
          department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
          recipient_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          sender_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
          kind TEXT NOT NULL CHECK (kind IN ('announcement', 'event_reminder')),
          title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
          body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
          event_id UUID REFERENCES service_events(id) ON DELETE CASCADE,
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
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (department_id, user_id)
        );
      `);
        await createUpcomingReminders();
        storageReady = true;
        reminderTimer = setInterval(() => { void createUpcomingReminders().catch((error) => routes.log.error({ err: error }, "Could not create event reminder notifications.")); }, 60_000);
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

    routes.get("/api/modules/notifications", async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const result = await pool!.query<NotificationRow>(
        `SELECT id, kind, title, body, event_id, created_at, read_at
           FROM module_notifications
          WHERE department_id = $1 AND recipient_user_id = $2
          ORDER BY created_at DESC LIMIT 100`,
        [departmentId, request.authenticatedUser!.id],
      );
      const preferences = await pool!.query(
        `SELECT event_reminders_enabled FROM module_notification_preferences WHERE department_id = $1 AND user_id = $2`,
        [departmentId, request.authenticatedUser!.id],
      );
      const notifications = result.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        ...(row.event_id ? { eventId: row.event_id } : {}),
        createdAt: new Date(row.created_at).toISOString(),
        ...(row.read_at ? { readAt: new Date(row.read_at).toISOString() } : {}),
      }));
      return {
        notifications,
        unreadCount: notifications.filter((item) => !item.readAt).length,
        eventRemindersEnabled: preferences.rows[0]?.event_reminders_enabled ?? true,
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

    routes.put<{ Body: { eventRemindersEnabled: boolean } }>("/api/modules/notifications/preferences", {
      schema: { body: { type: "object", additionalProperties: false, required: ["eventRemindersEnabled"], properties: { eventRemindersEnabled: { type: "boolean" } } } },
    }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      await pool!.query(
        `INSERT INTO module_notification_preferences (department_id, user_id, event_reminders_enabled)
         VALUES ($1, $2, $3)
         ON CONFLICT (department_id, user_id) DO UPDATE SET event_reminders_enabled = EXCLUDED.event_reminders_enabled, updated_at = now()`,
        [departmentId, request.authenticatedUser!.id, request.body.eventRemindersEnabled],
      );
      return { eventRemindersEnabled: request.body.eventRemindersEnabled };
    });

    routes.post<{ Body: { title: string; body: string } }>("/api/modules/notifications/announcements", { schema: announcementSchema }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      if (request.activeDepartmentRole !== "site_admin") return reply.code(403).send({ error: "Only a site administrator can send a location announcement." });
      const title = request.body.title.trim();
      const body = request.body.body.trim();
      if (!title || !body) return reply.code(400).send({ error: "Enter a title and message." });
      const client = await pool!.connect();
      let recipientCount = 0;
      try {
        await client.query("BEGIN");
        const recipients = await client.query("SELECT user_id FROM department_memberships WHERE department_id = $1", [departmentId]);
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
      return reply.code(201).send({ sent: true, recipientCount });
    });
  });
}
