import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";

type ChatMessageRow = {
  id: string;
  user_id: string;
  display_name: string;
  body: string;
  created_at: Date | string;
  seen_by?: string[];
};

const createConversationSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["userIds"],
    properties: {
      userIds: { type: "array", minItems: 1, maxItems: 49, uniqueItems: true, items: { type: "string", format: "uuid" } },
      name: { type: "string", maxLength: 80 },
    },
  },
};

const presenceSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["sessionId", "focused", "notificationsEnabled"],
    properties: {
      sessionId: { type: "string", format: "uuid" },
      focused: { type: "boolean" },
      notificationsEnabled: { type: "boolean" },
    },
  },
};

const editConversationSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
      name: { type: "string", maxLength: 80 },
      titleSuffix: { type: "string", maxLength: 60 },
      onlyIfEmpty: { type: "boolean" },
    },
  },
};

const addGroupMemberSchema = {
  body: { type: "object", additionalProperties: false, required: ["userId"], properties: { userId: { type: "string", format: "uuid" } } },
};

const groupMemberRoleSchema = {
  body: { type: "object", additionalProperties: false, required: ["role"], properties: { role: { type: "string", enum: ["admin", "member"] } } },
};

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation, realtime } = context;
  let storageReady = false;

  app.register(async (routes) => {
    routes.addHook("onReady", async () => {
      if (!pool || !isDatabaseReady()) return;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`
          CREATE TABLE IF NOT EXISTS module_chat_schema_version (
            singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
            version INTEGER NOT NULL
          )
        `);
        const schema = await client.query("SELECT version FROM module_chat_schema_version WHERE singleton = true");
        if ((schema.rows[0]?.version ?? 0) < 3) {
          await client.query(`
            DROP TABLE IF EXISTS module_chat_typing, module_chat_read_receipts,
              module_chat_conversation_messages, module_chat_conversation_members,
              module_chat_conversations, module_chat_presence CASCADE
          `);
        }
        if ((schema.rows[0]?.version ?? 0) < 4) {
          // Presence is per browser tab now; old aggregate rows cannot tell whether a user
          // still has an active session, so let the transient presence table start clean.
          await client.query("DROP TABLE IF EXISTS module_chat_presence CASCADE");
        }
        await client.query(`
        CREATE TABLE IF NOT EXISTS module_chat_conversations (
          id UUID PRIMARY KEY,
          department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
          name TEXT CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 80),
          title_suffix TEXT CHECK (title_suffix IS NULL OR char_length(title_suffix) <= 60),
          direct_key TEXT,
          created_by UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (id, department_id),
          CHECK ((kind = 'direct' AND direct_key IS NOT NULL AND name IS NULL) OR (kind = 'group' AND direct_key IS NULL))
        );
        CREATE TABLE IF NOT EXISTS module_chat_conversation_members (
          conversation_id UUID NOT NULL,
          department_id UUID NOT NULL,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          member_role TEXT NOT NULL DEFAULT 'member' CHECK (member_role IN ('owner', 'admin', 'member')),
          name_suffix TEXT CHECK (name_suffix IS NULL OR char_length(name_suffix) <= 60),
          joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (conversation_id, user_id),
          FOREIGN KEY (conversation_id, department_id) REFERENCES module_chat_conversations(id, department_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS module_chat_members_user_idx
          ON module_chat_conversation_members (department_id, user_id, joined_at DESC);
        CREATE TABLE IF NOT EXISTS module_chat_conversation_messages (
          id UUID PRIMARY KEY,
          conversation_id UUID NOT NULL,
          department_id UUID NOT NULL,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (id, conversation_id, department_id),
          FOREIGN KEY (conversation_id, department_id) REFERENCES module_chat_conversations(id, department_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS module_chat_messages_conversation_created_idx
          ON module_chat_conversation_messages (conversation_id, created_at DESC, id DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS module_chat_message_receipt_target_idx
          ON module_chat_conversation_messages (id, conversation_id, department_id);
        CREATE TABLE IF NOT EXISTS module_chat_read_receipts (
          conversation_id UUID NOT NULL,
          department_id UUID NOT NULL,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          last_read_message_id UUID,
          last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (conversation_id, user_id),
          FOREIGN KEY (conversation_id, department_id) REFERENCES module_chat_conversations(id, department_id) ON DELETE CASCADE,
          FOREIGN KEY (last_read_message_id, conversation_id, department_id)
            REFERENCES module_chat_conversation_messages(id, conversation_id, department_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS module_chat_presence (
          department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          session_id UUID NOT NULL,
          focused BOOLEAN NOT NULL DEFAULT false,
          notifications_enabled BOOLEAN NOT NULL DEFAULT false,
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (department_id, user_id, session_id)
        );
        CREATE TABLE IF NOT EXISTS module_chat_typing (
          conversation_id UUID NOT NULL,
          department_id UUID NOT NULL,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          typing_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (conversation_id, user_id),
          FOREIGN KEY (conversation_id, department_id) REFERENCES module_chat_conversations(id, department_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS module_chat_typing_conversation_idx
          ON module_chat_typing (conversation_id, department_id, typing_at DESC);
      `);
        if ((schema.rows[0]?.version ?? 0) < 5) {
          await client.query(`
            ALTER TABLE module_chat_conversation_members
              DROP CONSTRAINT IF EXISTS module_chat_conversation_members_member_role_check;
            ALTER TABLE module_chat_conversation_members
              ADD CONSTRAINT module_chat_conversation_members_member_role_check
              CHECK (member_role IN ('owner', 'admin', 'member'));
            ALTER TABLE module_chat_conversation_members
              ADD COLUMN IF NOT EXISTS name_suffix TEXT
              CHECK (name_suffix IS NULL OR char_length(name_suffix) <= 60);
          `);
        }
        if ((schema.rows[0]?.version ?? 0) < 7) {
          await client.query("DROP INDEX IF EXISTS module_chat_direct_pair_idx");
        }
        if ((schema.rows[0]?.version ?? 0) < 8) {
          await client.query(`
            ALTER TABLE module_chat_conversations
              ADD COLUMN IF NOT EXISTS title_suffix TEXT
              CHECK (title_suffix IS NULL OR char_length(title_suffix) <= 60)
          `);
        }
        if ((schema.rows[0]?.version ?? 0) < 9) {
          await client.query(`
            UPDATE module_chat_conversations conversation
               SET title_suffix = (
                 SELECT member.name_suffix
                   FROM module_chat_conversation_members member
                  WHERE member.conversation_id = conversation.id
                    AND member.name_suffix IS NOT NULL
                  ORDER BY CASE WHEN member.member_role = 'owner' THEN 0 ELSE 1 END, member.joined_at
                  LIMIT 1
               )
             WHERE conversation.kind = 'direct'
               AND conversation.title_suffix IS NULL
               AND EXISTS (
                 SELECT 1 FROM module_chat_conversation_members member
                  WHERE member.conversation_id = conversation.id AND member.name_suffix IS NOT NULL
               )
          `);
        }
        await client.query(`
          INSERT INTO module_chat_schema_version (singleton, version) VALUES (true, 9)
          ON CONFLICT (singleton) DO UPDATE SET version = EXCLUDED.version
        `);
        await client.query("COMMIT");
        storageReady = true;
      } catch (error) {
        await client.query("ROLLBACK");
        routes.log.error({ err: error }, "Optional Chat storage could not be initialized; the rest of Smart-Church will continue.");
      } finally {
        client.release();
      }
    });

    async function department(request: FastifyRequest, reply: FastifyReply) {
      if (!pool || !isDatabaseReady() || !storageReady) {
        reply.code(503).send({ error: "Chat is temporarily unavailable because its storage could not be initialized." });
        return null;
      }
      return resolveDepartmentId(request, reply);
    }

    async function isConversationMember(conversationId: string, departmentId: string, userId: string) {
      const result = await pool!.query(
        `SELECT 1 FROM module_chat_conversation_members
          WHERE conversation_id = $1 AND department_id = $2 AND user_id = $3`,
        [conversationId, departmentId, userId],
      );
      return (result.rowCount ?? 0) > 0;
    }

    async function getConversationAccess(conversationId: string, departmentId: string, userId: string) {
      const result = await pool!.query(
        `SELECT c.id, c.kind, c.created_by, member.member_role
           FROM module_chat_conversations c
           JOIN module_chat_conversation_members member
             ON member.conversation_id = c.id AND member.department_id = c.department_id
          WHERE c.id = $1 AND c.department_id = $2 AND member.user_id = $3`,
        [conversationId, departmentId, userId],
      );
      return result.rows[0] as { id: string; kind: "direct" | "group"; created_by: string; member_role: "owner" | "admin" | "member" } | undefined;
    }

    const stopPresenceMessages = realtime.onMessage("module:chat:presence", async ({ userId, departmentId }, payload) => {
      if (!pool || !storageReady || !payload || typeof payload !== "object") return;
      const message = payload as { sessionId?: unknown; focused?: unknown; notificationsEnabled?: unknown };
      if (typeof message.sessionId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(message.sessionId)
        || typeof message.focused !== "boolean" || typeof message.notificationsEnabled !== "boolean") return;
      await pool.query("DELETE FROM module_chat_presence WHERE last_seen_at < now() - interval '2 minutes'");
      await pool.query(
        `INSERT INTO module_chat_presence (department_id, user_id, session_id, focused, notifications_enabled, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (department_id, user_id, session_id) DO UPDATE
           SET focused = EXCLUDED.focused, notifications_enabled = EXCLUDED.notifications_enabled, last_seen_at = now()`,
        [departmentId, userId, message.sessionId, message.focused, message.notificationsEnabled],
      );
      realtime.publish("module:chat:presence", departmentId);
    });
    const stopPresenceLeaveMessages = realtime.onMessage("module:chat:presence:leave", async ({ userId, departmentId }, payload) => {
      if (!pool || !storageReady || !payload || typeof payload !== "object") return;
      const sessionId = (payload as { sessionId?: unknown }).sessionId;
      if (typeof sessionId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(sessionId)) return;
      await pool.query("DELETE FROM module_chat_presence WHERE department_id = $1 AND user_id = $2 AND session_id = $3", [departmentId, userId, sessionId]);
      realtime.publish("module:chat:presence", departmentId);
    });
    const stopTypingMessages = realtime.onMessage("module:chat:typing", async ({ userId, departmentId }, payload) => {
      if (!pool || !storageReady || !payload || typeof payload !== "object") return;
      const message = payload as { conversationId?: unknown; typing?: unknown };
      if (typeof message.conversationId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(message.conversationId) || typeof message.typing !== "boolean") return;
      if (!await isConversationMember(message.conversationId, departmentId, userId)) return;
      if (message.typing) {
        await pool.query(
          `INSERT INTO module_chat_typing (conversation_id, department_id, user_id, typing_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (conversation_id, user_id) DO UPDATE SET typing_at = now(), department_id = EXCLUDED.department_id`,
          [message.conversationId, departmentId, userId],
        );
      } else {
        await pool.query("DELETE FROM module_chat_typing WHERE conversation_id = $1 AND department_id = $2 AND user_id = $3", [message.conversationId, departmentId, userId]);
      }
      realtime.publish("module:chat:typing", departmentId, { conversationId: message.conversationId });
    });
    routes.addHook("onClose", async () => { stopPresenceMessages(); stopPresenceLeaveMessages(); stopTypingMessages(); });

    routes.get("/api/modules/chat/contacts", async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const result = await pool!.query(
        `SELECT DISTINCT u.id, u.display_name, u.role = 'server_admin' AS is_admin,
                CASE WHEN NOT presence.active THEN 'offline'
                     WHEN presence.green THEN 'online' ELSE 'away' END AS presence_status,
                presence.active AS online
           FROM app_users u
           LEFT JOIN department_memberships m ON m.department_id = $1 AND m.user_id = u.id
           LEFT JOIN LATERAL (
             SELECT count(*) > 0 AS active,
                    COALESCE(bool_or(focused OR notifications_enabled), false) AS green
               FROM module_chat_presence p
              WHERE p.department_id = $1 AND p.user_id = u.id
                AND p.last_seen_at > now() - interval '55 seconds'
           ) presence ON true
          WHERE u.id <> $2 AND m.user_id IS NOT NULL
          ORDER BY u.display_name, u.id`,
        [departmentId, request.authenticatedUser!.id],
      );
      return { contacts: result.rows.map((row) => ({ id: row.id, displayName: row.display_name, online: row.online, presenceStatus: row.presence_status, isAdmin: row.is_admin })) };
    });

    routes.post<{ Body: { sessionId: string; focused: boolean; notificationsEnabled: boolean } }>("/api/modules/chat/presence", { schema: presenceSchema }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      await pool!.query("DELETE FROM module_chat_presence WHERE last_seen_at < now() - interval '2 minutes'");
      await pool!.query(
        `INSERT INTO module_chat_presence
           (department_id, user_id, session_id, focused, notifications_enabled, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (department_id, user_id, session_id) DO UPDATE
           SET focused = EXCLUDED.focused,
               notifications_enabled = EXCLUDED.notifications_enabled,
               last_seen_at = now()`,
        [departmentId, request.authenticatedUser!.id, request.body.sessionId, request.body.focused, request.body.notificationsEnabled],
      );
      return { online: true };
    });

    routes.delete<{ Body: { sessionId: string } }>("/api/modules/chat/presence", { schema: { body: { type: "object", additionalProperties: false, required: ["sessionId"], properties: { sessionId: { type: "string", format: "uuid" } } } } }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      await pool!.query(
        "DELETE FROM module_chat_presence WHERE department_id = $1 AND user_id = $2 AND session_id = $3",
        [departmentId, request.authenticatedUser!.id, request.body.sessionId],
      );
      return { online: false };
    });

    routes.get<{ Params: { id: string } }>("/api/modules/chat/conversations/:id/typing", {
      schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
    }, async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const userId = request.authenticatedUser!.id;
      if (!await isConversationMember(request.params.id, departmentId, userId)) return reply.code(404).send({ error: "Conversation not found." });
      const result = await pool!.query(
        `SELECT u.display_name
           FROM module_chat_typing typing
           JOIN module_chat_conversation_members member
             ON member.conversation_id = typing.conversation_id
            AND member.department_id = typing.department_id
            AND member.user_id = typing.user_id
           JOIN app_users u ON u.id = typing.user_id
          WHERE typing.conversation_id = $1 AND typing.department_id = $2
            AND typing.user_id <> $3 AND typing.typing_at > now() - interval '8 seconds'
          ORDER BY typing.typing_at DESC, u.display_name` ,
        [request.params.id, departmentId, userId],
      );
      return { typingUsers: result.rows.map((row) => row.display_name) };
    });

    routes.post<{ Params: { id: string } }>("/api/modules/chat/conversations/:id/typing", {
      schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
    }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const userId = request.authenticatedUser!.id;
      if (!await isConversationMember(request.params.id, departmentId, userId)) return reply.code(404).send({ error: "Conversation not found." });
      await pool!.query(
        `INSERT INTO module_chat_typing (conversation_id, department_id, user_id, typing_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (conversation_id, user_id) DO UPDATE SET typing_at = now(), department_id = EXCLUDED.department_id`,
        [request.params.id, departmentId, userId],
      );
      return { typing: true };
    });

    routes.delete<{ Params: { id: string } }>("/api/modules/chat/conversations/:id/typing", {
      schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
    }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const userId = request.authenticatedUser!.id;
      if (!await isConversationMember(request.params.id, departmentId, userId)) return reply.code(404).send({ error: "Conversation not found." });
      await pool!.query("DELETE FROM module_chat_typing WHERE conversation_id = $1 AND department_id = $2 AND user_id = $3", [request.params.id, departmentId, userId]);
      return { typing: false };
    });

    routes.get("/api/modules/chat/conversations", async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const result = await pool!.query(
        `SELECT c.id, c.kind, c.name, c.title_suffix, c.created_by, c.created_at,
                COALESCE(json_agg(json_build_object('id', m.user_id, 'displayName', u.display_name, 'role', m.member_role,
                  'online', presence.active,
                  'presenceStatus', CASE WHEN NOT presence.active THEN 'offline' WHEN presence.green THEN 'online' ELSE 'away' END) ORDER BY u.display_name)
                  FILTER (WHERE m.user_id IS NOT NULL), '[]'::json) AS participants,
                latest.body AS last_message,
                latest.created_at AS last_message_at,
                COALESCE(unread.count, 0)::int AS unread_count,
                unread_latest.id AS unread_message_id,
                unread_latest.body AS unread_message_body,
                unread_latest.author AS unread_message_author
           FROM module_chat_conversations c
           JOIN module_chat_conversation_members mine
             ON mine.conversation_id = c.id AND mine.department_id = c.department_id AND mine.user_id = $2
           LEFT JOIN module_chat_conversation_members m
             ON m.conversation_id = c.id AND m.department_id = c.department_id
           LEFT JOIN app_users u ON u.id = m.user_id
           LEFT JOIN LATERAL (
             SELECT count(*) > 0 AS active,
                    COALESCE(bool_or(focused OR notifications_enabled), false) AS green
               FROM module_chat_presence p
              WHERE p.department_id = c.department_id AND p.user_id = m.user_id
                AND p.last_seen_at > now() - interval '55 seconds'
           ) presence ON true
           LEFT JOIN LATERAL (
             SELECT body, created_at FROM module_chat_conversation_messages
              WHERE conversation_id = c.id AND department_id = c.department_id
              ORDER BY created_at DESC, id DESC LIMIT 1
           ) latest ON true
           LEFT JOIN module_chat_read_receipts receipt
             ON receipt.conversation_id = c.id AND receipt.department_id = c.department_id AND receipt.user_id = $2
           LEFT JOIN module_chat_conversation_messages read_through
             ON read_through.id = receipt.last_read_message_id
            AND read_through.conversation_id = receipt.conversation_id
            AND read_through.department_id = receipt.department_id
           LEFT JOIN LATERAL (
             SELECT count(*) AS count FROM module_chat_conversation_messages unread_message
              WHERE unread_message.conversation_id = c.id
                AND unread_message.department_id = c.department_id
                AND unread_message.user_id <> $2
                AND (read_through.id IS NULL OR (unread_message.created_at, unread_message.id) > (read_through.created_at, read_through.id))
           ) unread ON true
           LEFT JOIN LATERAL (
             SELECT unread_message.id, unread_message.body, author.display_name AS author
               FROM module_chat_conversation_messages unread_message
               JOIN app_users author ON author.id = unread_message.user_id
              WHERE unread_message.conversation_id = c.id
                AND unread_message.department_id = c.department_id
                AND unread_message.user_id <> $2
                AND (read_through.id IS NULL OR (unread_message.created_at, unread_message.id) > (read_through.created_at, read_through.id))
              ORDER BY unread_message.created_at DESC, unread_message.id DESC LIMIT 1
           ) unread_latest ON true
          WHERE c.department_id = $1
          GROUP BY c.id, latest.body, latest.created_at, unread.count,
                   unread_latest.id, unread_latest.body, unread_latest.author
          ORDER BY COALESCE(latest.created_at, c.created_at) DESC, c.id DESC`,
        [departmentId, request.authenticatedUser!.id],
      );
      return {
        conversations: result.rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          name: row.name,
          titleSuffix: row.title_suffix,
          createdBy: row.created_by,
          participants: row.participants,
          lastMessage: row.last_message,
          unreadCount: row.unread_count,
          latestUnreadMessage: row.unread_message_id ? {
            id: row.unread_message_id,
            body: row.unread_message_body,
            author: row.unread_message_author,
          } : null,
          updatedAt: new Date(row.last_message_at ?? row.created_at).toISOString(),
        })),
        currentUserId: request.authenticatedUser!.id,
        canModerate: request.activeDepartmentRole === "site_admin",
      };
    });

    routes.post<{ Body: { userIds: string[]; name?: string } }>("/api/modules/chat/conversations", { schema: createConversationSchema }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const currentUserId = request.authenticatedUser!.id;
      if (request.body.userIds.includes(currentUserId)) return reply.code(400).send({ error: "Choose other members to start a conversation." });
      const contacts = await pool!.query(
        `SELECT u.id FROM app_users u
          LEFT JOIN department_memberships m ON m.department_id = $1 AND m.user_id = u.id
         WHERE u.id = ANY($2::uuid[]) AND m.user_id IS NOT NULL`,
        [departmentId, request.body.userIds],
      );
      if (contacts.rowCount !== request.body.userIds.length) return reply.code(400).send({ error: "Choose members of this location." });

      const isDirect = request.body.userIds.length === 1;
      const directKey = isDirect ? [currentUserId, request.body.userIds[0]].sort().join(":") : null;
      const name = isDirect ? null : request.body.name?.trim() || null;
      const client = await pool!.connect();
      let conversationId: string;
      try {
        await client.query("BEGIN");
        const inserted = await client.query(
          `INSERT INTO module_chat_conversations (id, department_id, kind, name, direct_key, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [randomUUID(), departmentId, isDirect ? "direct" : "group", name, directKey, currentUserId],
        );
        conversationId = inserted.rows[0].id;
        await client.query(
          `INSERT INTO module_chat_conversation_members (conversation_id, department_id, user_id, member_role)
           SELECT $1, $2, member_id, CASE WHEN member_id = $3 THEN 'owner' ELSE 'member' END
             FROM unnest($4::uuid[]) AS member_id
           ON CONFLICT (conversation_id, user_id) DO NOTHING`,
          [conversationId, departmentId, currentUserId, [currentUserId, ...request.body.userIds]],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
      return reply.code(201).send({ id: conversationId });
    });

    routes.patch<{ Params: { id: string }; Body: { name?: string; titleSuffix?: string; onlyIfEmpty?: boolean } }>("/api/modules/chat/conversations/:id", {
      schema: {
        params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
        body: editConversationSchema.body,
      },
    }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const userId = request.authenticatedUser!.id;
      const access = await getConversationAccess(request.params.id, departmentId, userId);
      if (!access) return reply.code(404).send({ error: "Conversation not found." });
      let updated = true;
      if (access.kind === "group") {
        if (request.body.name === undefined || request.body.titleSuffix !== undefined || request.body.onlyIfEmpty !== undefined) return reply.code(400).send({ error: "Set a group name to edit this conversation." });
        if (access.member_role !== "owner" && access.member_role !== "admin") return reply.code(403).send({ error: "Only group admins can rename this chat." });
        await pool!.query(
          "UPDATE module_chat_conversations SET name = NULLIF(BTRIM($3), '') WHERE id = $1 AND department_id = $2",
          [request.params.id, departmentId, request.body.name],
        );
      } else {
        if (request.body.titleSuffix === undefined || request.body.name !== undefined) return reply.code(400).send({ error: "Set a direct chat name suffix to edit this conversation." });
        const result = await pool!.query(
          request.body.onlyIfEmpty
            ? "UPDATE module_chat_conversations SET title_suffix = NULLIF(BTRIM($3), '') WHERE id = $1 AND department_id = $2 AND title_suffix IS NULL"
            : "UPDATE module_chat_conversations SET title_suffix = NULLIF(BTRIM($3), '') WHERE id = $1 AND department_id = $2",
          [request.params.id, departmentId, request.body.titleSuffix],
        );
        updated = (result.rowCount ?? 0) > 0;
      }
      return { updated };
    });

    routes.post<{ Params: { id: string }; Body: { userId: string } }>("/api/modules/chat/conversations/:id/members", {
      schema: {
        params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
        body: addGroupMemberSchema.body,
      },
    }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const userId = request.authenticatedUser!.id;
      const access = await getConversationAccess(request.params.id, departmentId, userId);
      if (!access || access.kind !== "group") return reply.code(404).send({ error: "Group chat not found." });
      if (access.member_role !== "owner" && access.member_role !== "admin") return reply.code(403).send({ error: "Only group admins can add people." });
      const contact = await pool!.query(
        `SELECT u.id FROM app_users u
          LEFT JOIN department_memberships membership ON membership.department_id = $1 AND membership.user_id = u.id
         WHERE u.id = $2 AND membership.user_id IS NOT NULL`,
        [departmentId, request.body.userId],
      );
      if (!contact.rowCount) return reply.code(400).send({ error: "Choose a member of this location." });
      await pool!.query(
        `INSERT INTO module_chat_conversation_members (conversation_id, department_id, user_id, member_role)
         VALUES ($1, $2, $3, 'member') ON CONFLICT (conversation_id, user_id) DO NOTHING`,
        [request.params.id, departmentId, request.body.userId],
      );
      return reply.code(201).send({ added: true });
    });

    routes.patch<{ Params: { id: string; userId: string }; Body: { role: "admin" | "member" } }>("/api/modules/chat/conversations/:id/members/:userId", {
      schema: {
        params: { type: "object", required: ["id", "userId"], properties: { id: { type: "string", format: "uuid" }, userId: { type: "string", format: "uuid" } } },
        body: groupMemberRoleSchema.body,
      },
    }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const userId = request.authenticatedUser!.id;
      const access = await getConversationAccess(request.params.id, departmentId, userId);
      if (!access || access.kind !== "group") return reply.code(404).send({ error: "Group chat not found." });
      if (access.created_by !== userId) return reply.code(403).send({ error: "Only the group creator can change admin roles." });
      const result = await pool!.query(
        `UPDATE module_chat_conversation_members
            SET member_role = $4
          WHERE conversation_id = $1 AND department_id = $2 AND user_id = $3 AND user_id <> $5
          RETURNING user_id`,
        [request.params.id, departmentId, request.params.userId, request.body.role, access.created_by],
      );
      if (!result.rowCount) return reply.code(404).send({ error: "Group member not found." });
      return { updated: true };
    });

    routes.delete<{ Params: { id: string; userId: string } }>("/api/modules/chat/conversations/:id/members/:userId", {
      schema: { params: { type: "object", required: ["id", "userId"], properties: { id: { type: "string", format: "uuid" }, userId: { type: "string", format: "uuid" } } } },
    }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const userId = request.authenticatedUser!.id;
      const access = await getConversationAccess(request.params.id, departmentId, userId);
      if (!access || access.kind !== "group") return reply.code(404).send({ error: "Group chat not found." });
      if (access.member_role !== "owner" && access.member_role !== "admin") return reply.code(403).send({ error: "Only group admins can remove people." });
      const removed = await pool!.query(
        `DELETE FROM module_chat_conversation_members target
          WHERE target.conversation_id = $1 AND target.department_id = $2 AND target.user_id = $3
            AND target.user_id <> $4
            AND (target.member_role <> 'admin' OR $4 = $5)
          RETURNING target.user_id`,
        [request.params.id, departmentId, request.params.userId, access.created_by, userId],
      );
      if (!removed.rowCount) return reply.code(404).send({ error: "Group member not found or cannot be removed." });
      return { removed: true };
    });

    routes.delete<{ Params: { id: string } }>("/api/modules/chat/conversations/:id", {
      schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
    }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const result = await pool!.query(
        `DELETE FROM module_chat_conversations conversation
          WHERE conversation.id = $1 AND conversation.department_id = $2
            AND EXISTS (
              SELECT 1 FROM module_chat_conversation_members member
               WHERE member.conversation_id = conversation.id
                 AND member.department_id = conversation.department_id
                 AND member.user_id = $3
            )
          RETURNING conversation.id`,
        [request.params.id, departmentId, request.authenticatedUser!.id],
      );
      if (!result.rowCount) return reply.code(404).send({ error: "Conversation not found." });
      return { deleted: true };
    });

    routes.get<{ Params: { id: string } }>("/api/modules/chat/conversations/:id/messages", {
      schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
    }, async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      if (!await isConversationMember(request.params.id, departmentId, request.authenticatedUser!.id)) return reply.code(404).send({ error: "Conversation not found." });
      await pool!.query(
        `INSERT INTO module_chat_read_receipts (conversation_id, department_id, user_id, last_read_message_id, last_read_at)
         SELECT $1, $2, $3, id, now()
           FROM module_chat_conversation_messages
          WHERE conversation_id = $1 AND department_id = $2
          ORDER BY created_at DESC, id DESC LIMIT 1
         ON CONFLICT (conversation_id, user_id) DO UPDATE
           SET last_read_message_id = EXCLUDED.last_read_message_id, last_read_at = now()`,
        [request.params.id, departmentId, request.authenticatedUser!.id],
      );
      const result = await pool!.query<ChatMessageRow>(
        `SELECT m.id, m.user_id, u.display_name, m.body, m.created_at,
                COALESCE(seen.readers, ARRAY[]::TEXT[]) AS seen_by
           FROM module_chat_conversation_messages m
           JOIN app_users u ON u.id = m.user_id
           LEFT JOIN LATERAL (
             SELECT array_agg(reader.display_name ORDER BY reader.display_name) AS readers
               FROM module_chat_read_receipts receipt
               JOIN module_chat_conversation_messages read_through
                 ON read_through.id = receipt.last_read_message_id
                AND read_through.conversation_id = receipt.conversation_id
                AND read_through.department_id = receipt.department_id
               JOIN app_users reader ON reader.id = receipt.user_id
              WHERE receipt.conversation_id = m.conversation_id
                AND receipt.department_id = m.department_id
                AND receipt.user_id <> $3
                AND (read_through.created_at, read_through.id) >= (m.created_at, m.id)
           ) seen ON true
          WHERE m.conversation_id = $1 AND m.department_id = $2
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT 100`,
        [request.params.id, departmentId, request.authenticatedUser!.id],
      );
      return { messages: result.rows.reverse().map((row) => ({ id: row.id, userId: row.user_id, author: row.display_name, body: row.body, createdAt: new Date(row.created_at).toISOString(), seenBy: row.seen_by ?? [] })) };
    });

    routes.post<{ Params: { id: string }; Body: { body: string } }>("/api/modules/chat/conversations/:id/messages", {
      schema: {
        params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
        body: { type: "object", additionalProperties: false, required: ["body"], properties: { body: { type: "string", minLength: 1, maxLength: 2000 } } },
      },
    }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const userId = request.authenticatedUser!.id;
      if (!await isConversationMember(request.params.id, departmentId, userId)) return reply.code(404).send({ error: "Conversation not found." });
      const body = request.body.body.trim();
      if (!body) return reply.code(400).send({ error: "Write a message before sending." });
      if (body.length > 2000) return reply.code(400).send({ error: "Messages can contain up to 2,000 characters." });
      const result = await pool!.query<ChatMessageRow>(
        `INSERT INTO module_chat_conversation_messages (id, conversation_id, department_id, user_id, body)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, user_id, (SELECT display_name FROM app_users WHERE id = $4) AS display_name, body, created_at`,
        [randomUUID(), request.params.id, departmentId, userId, body],
      );
      const row = result.rows[0];
      return reply.code(201).send({ message: { id: row.id, userId: row.user_id, author: row.display_name, body: row.body, createdAt: new Date(row.created_at).toISOString() } });
    });

    routes.delete<{ Params: { id: string; messageId: string } }>("/api/modules/chat/conversations/:id/messages/:messageId", {
      schema: { params: { type: "object", required: ["id", "messageId"], properties: { id: { type: "string", format: "uuid" }, messageId: { type: "string", format: "uuid" } } } },
    }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const userId = request.authenticatedUser!.id;
      if (!await isConversationMember(request.params.id, departmentId, userId)) return reply.code(404).send({ error: "Conversation not found." });
      const result = await pool!.query(
        `DELETE FROM module_chat_conversation_messages
          WHERE id = $1 AND conversation_id = $2 AND department_id = $3
            AND (user_id = $4 OR $5 = true)
          RETURNING id`,
        [request.params.messageId, request.params.id, departmentId, userId, request.activeDepartmentRole === "site_admin"],
      );
      if (!result.rowCount) return reply.code(404).send({ error: "Message not found or you cannot delete it." });
      return { deleted: true };
    });
  });
}
