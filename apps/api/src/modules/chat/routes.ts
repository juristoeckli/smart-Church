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

const addMembersSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["userIds"],
    properties: { userIds: { type: "array", minItems: 1, maxItems: 49, uniqueItems: true, items: { type: "string", format: "uuid" } } },
  },
};

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation } = context;
  let storageReady = false;

  app.register(async (routes) => {
    routes.addHook("onReady", async () => {
      if (!pool || !isDatabaseReady()) return;
      try {
        await pool.query(`
        CREATE TABLE IF NOT EXISTS module_chat_conversations (
          id UUID PRIMARY KEY,
          department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
          name TEXT CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 80),
          direct_key TEXT,
          created_by UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (id, department_id),
          CHECK ((kind = 'direct' AND direct_key IS NOT NULL AND name IS NULL) OR (kind = 'group' AND direct_key IS NULL))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS module_chat_direct_pair_idx
          ON module_chat_conversations (department_id, direct_key) WHERE kind = 'direct';
        CREATE TABLE IF NOT EXISTS module_chat_conversation_members (
          conversation_id UUID NOT NULL,
          department_id UUID NOT NULL,
          user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          member_role TEXT NOT NULL DEFAULT 'member' CHECK (member_role IN ('owner', 'member')),
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
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (department_id, user_id)
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
        storageReady = true;
      } catch (error) {
        routes.log.error({ err: error }, "Optional Chat storage could not be initialized; the rest of Smart-Church will continue.");
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

    routes.get("/api/modules/chat/contacts", async (request, reply) => {
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const result = await pool!.query(
        `SELECT u.id, u.display_name, COALESCE(p.last_seen_at > now() - interval '75 seconds', false) AS online
           FROM department_memberships m
           JOIN app_users u ON u.id = m.user_id
           LEFT JOIN module_chat_presence p ON p.department_id = m.department_id AND p.user_id = m.user_id
          WHERE m.department_id = $1 AND m.user_id <> $2
          ORDER BY u.display_name, u.id`,
        [departmentId, request.authenticatedUser!.id],
      );
      return { contacts: result.rows.map((row) => ({ id: row.id, displayName: row.display_name, online: row.online })) };
    });

    routes.post("/api/modules/chat/presence", async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      await pool!.query(
        `INSERT INTO module_chat_presence (department_id, user_id, last_seen_at)
         VALUES ($1, $2, now())
         ON CONFLICT (department_id, user_id) DO UPDATE SET last_seen_at = now()`,
        [departmentId, request.authenticatedUser!.id],
      );
      return { online: true };
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
        `SELECT c.id, c.kind, c.name, c.created_at,
                COALESCE(json_agg(json_build_object('userId', m.user_id, 'displayName', u.display_name, 'role', m.member_role,
                  'online', COALESCE(p.last_seen_at > now() - interval '75 seconds', false)) ORDER BY u.display_name)
                  FILTER (WHERE m.user_id IS NOT NULL), '[]'::json) AS participants,
                latest.body AS last_message,
                latest.created_at AS last_message_at,
                COALESCE(unread.count, 0)::int AS unread_count
           FROM module_chat_conversations c
           JOIN module_chat_conversation_members mine
             ON mine.conversation_id = c.id AND mine.department_id = c.department_id AND mine.user_id = $2
           LEFT JOIN module_chat_conversation_members m
             ON m.conversation_id = c.id AND m.department_id = c.department_id
           LEFT JOIN app_users u ON u.id = m.user_id
           LEFT JOIN module_chat_presence p ON p.department_id = c.department_id AND p.user_id = m.user_id
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
          WHERE c.department_id = $1
          GROUP BY c.id, latest.body, latest.created_at, unread.count
          ORDER BY COALESCE(latest.created_at, c.created_at) DESC, c.id DESC`,
        [departmentId, request.authenticatedUser!.id],
      );
      return {
        conversations: result.rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          name: row.name,
          participants: row.participants,
          lastMessage: row.last_message,
          unreadCount: row.unread_count,
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
        "SELECT user_id FROM department_memberships WHERE department_id = $1 AND user_id = ANY($2::uuid[])",
        [departmentId, request.body.userIds],
      );
      if (contacts.rowCount !== request.body.userIds.length) return reply.code(400).send({ error: "Every participant must be a member of this location." });

      const isDirect = request.body.userIds.length === 1;
      const directKey = isDirect ? [currentUserId, request.body.userIds[0]].sort().join(":") : null;
      const requestedName = request.body.name?.trim();
      if (requestedName && requestedName.length > 80) return reply.code(400).send({ error: "Group names can contain up to 80 characters." });
      const name = !isDirect && requestedName ? requestedName : null;
      const client = await pool!.connect();
      let conversationId: string;
      try {
        await client.query("BEGIN");
        const inserted = await client.query(
          `INSERT INTO module_chat_conversations (id, department_id, kind, name, direct_key, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [randomUUID(), departmentId, isDirect ? "direct" : "group", name, directKey, currentUserId],
        );
        if (inserted.rows[0]) conversationId = inserted.rows[0].id;
        else {
          const existing = await client.query(
            "SELECT id FROM module_chat_conversations WHERE department_id = $1 AND direct_key = $2 AND kind = 'direct'",
            [departmentId, directKey],
          );
          if (!existing.rows[0]) throw new Error("The conversation could not be created.");
          conversationId = existing.rows[0].id;
        }
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

    routes.patch<{ Params: { id: string }; Body: { name: string } }>("/api/modules/chat/conversations/:id", {
      schema: {
        params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
        body: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 80 } } },
      },
    }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const access = await pool!.query(
        `SELECT c.kind, m.member_role FROM module_chat_conversations c
          JOIN module_chat_conversation_members m ON m.conversation_id = c.id AND m.department_id = c.department_id
         WHERE c.id = $1 AND c.department_id = $2 AND m.user_id = $3`,
        [request.params.id, departmentId, request.authenticatedUser!.id],
      );
      if (!access.rows[0] || access.rows[0].kind !== "group") return reply.code(404).send({ error: "Group chat not found." });
      if (access.rows[0].member_role !== "owner" && request.activeDepartmentRole !== "site_admin") return reply.code(403).send({ error: "Only the group owner or a site administrator can rename this group." });
      const name = request.body.name.trim();
      if (!name) return reply.code(400).send({ error: "Enter a group name." });
      await pool!.query("UPDATE module_chat_conversations SET name = $3 WHERE id = $1 AND department_id = $2", [request.params.id, departmentId, name]);
      return { name };
    });

    routes.post<{ Params: { id: string }; Body: { userIds: string[] } }>("/api/modules/chat/conversations/:id/members", {
      schema: {
        params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
        body: addMembersSchema.body,
      },
    }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const access = await client.query(
          `SELECT c.kind, m.member_role FROM module_chat_conversations c
            JOIN module_chat_conversation_members m ON m.conversation_id = c.id AND m.department_id = c.department_id
           WHERE c.id = $1 AND c.department_id = $2 AND m.user_id = $3 FOR UPDATE OF c`,
          [request.params.id, departmentId, request.authenticatedUser!.id],
        );
        if (!access.rows[0] || access.rows[0].kind !== "group") {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "Group chat not found." });
        }
        if (access.rows[0].member_role !== "owner" && request.activeDepartmentRole !== "site_admin") {
          await client.query("ROLLBACK");
          return reply.code(403).send({ error: "Only the group owner or a site administrator can add members." });
        }
        const contacts = await client.query(
          "SELECT user_id FROM department_memberships WHERE department_id = $1 AND user_id = ANY($2::uuid[])",
          [departmentId, request.body.userIds],
        );
        if (contacts.rowCount !== request.body.userIds.length) {
          await client.query("ROLLBACK");
          return reply.code(400).send({ error: "Every participant must be a member of this location." });
        }
        const existing = await client.query("SELECT count(*)::int AS count FROM module_chat_conversation_members WHERE conversation_id = $1", [request.params.id]);
        const added = await client.query(
          `INSERT INTO module_chat_conversation_members (conversation_id, department_id, user_id, member_role)
           SELECT $1, $2, member_id, 'member' FROM unnest($3::uuid[]) AS member_id
           ON CONFLICT (conversation_id, user_id) DO NOTHING RETURNING user_id`,
          [request.params.id, departmentId, request.body.userIds],
        );
        if (existing.rows[0].count + added.rowCount! > 50) {
          await client.query("ROLLBACK");
          return reply.code(400).send({ error: "A group can have up to 50 members." });
        }
        await client.query("COMMIT");
        return { added: added.rowCount ?? 0 };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    });

    routes.delete<{ Params: { id: string; userId: string } }>("/api/modules/chat/conversations/:id/members/:userId", {
      schema: { params: { type: "object", required: ["id", "userId"], properties: { id: { type: "string", format: "uuid" }, userId: { type: "string", format: "uuid" } } } },
    }, async (request, reply) => {
      if (!validateMutation(request, reply)) return reply;
      const departmentId = await department(request, reply);
      if (!departmentId) return reply;
      const actorId = request.authenticatedUser!.id;
      const isLeaving = request.params.userId === actorId;
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const conversation = await client.query(
          `SELECT c.kind FROM module_chat_conversations c
            JOIN module_chat_conversation_members actor ON actor.conversation_id = c.id AND actor.department_id = c.department_id
           WHERE c.id = $1 AND c.department_id = $2 AND actor.user_id = $3 FOR UPDATE OF c`,
          [request.params.id, departmentId, actorId],
        );
        if (!conversation.rows[0] || conversation.rows[0].kind !== "group") {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "Group chat not found." });
        }
        const actor = await client.query(
          "SELECT member_role FROM module_chat_conversation_members WHERE conversation_id = $1 AND user_id = $2",
          [request.params.id, actorId],
        );
        if (!isLeaving && actor.rows[0]?.member_role !== "owner" && request.activeDepartmentRole !== "site_admin") {
          await client.query("ROLLBACK");
          return reply.code(403).send({ error: "Only the group owner or a site administrator can remove another member." });
        }
        const target = await client.query(
          "SELECT member_role FROM module_chat_conversation_members WHERE conversation_id = $1 AND user_id = $2 FOR UPDATE",
          [request.params.id, request.params.userId],
        );
        if (!target.rows[0]) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "Group member not found." });
        }
        if (target.rows[0].member_role === "owner") {
          const nextOwner = await client.query(
            `SELECT user_id FROM module_chat_conversation_members
              WHERE conversation_id = $1 AND user_id <> $2
              ORDER BY joined_at, user_id LIMIT 1 FOR UPDATE`,
            [request.params.id, request.params.userId],
          );
          if (nextOwner.rows[0]) {
            await client.query("UPDATE module_chat_conversation_members SET member_role = 'owner' WHERE conversation_id = $1 AND user_id = $2", [request.params.id, nextOwner.rows[0].user_id]);
          } else {
            await client.query("DELETE FROM module_chat_conversations WHERE id = $1 AND department_id = $2", [request.params.id, departmentId]);
            await client.query("COMMIT");
            return { left: isLeaving, deleted: true };
          }
        }
        await client.query("DELETE FROM module_chat_conversation_members WHERE conversation_id = $1 AND user_id = $2", [request.params.id, request.params.userId]);
        await client.query("DELETE FROM module_chat_read_receipts WHERE conversation_id = $1 AND user_id = $2", [request.params.id, request.params.userId]);
        await client.query("COMMIT");
        return { left: isLeaving, removed: !isLeaving };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
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
