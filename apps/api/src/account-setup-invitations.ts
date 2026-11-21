import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import { lockLocationAccessAdministrator, readLocationAccessGrants, recordLocationAccessChanges } from "./location-access-audit.js";

type Account = {
  id: string;
  username: string;
  email: string | null;
  password_hash: string;
  membership_scope: string;
  eligible: boolean;
};

const accounts = `SELECT id, username, email, password_hash,
  (SELECT jsonb_agg(jsonb_build_array(department_id, role, contact_id, permissions,
                                    video_permissions, presenter_permissions, module_permissions)
                    ORDER BY department_id)::text FROM department_memberships WHERE user_id = app_users.id) AS membership_scope,
  (is_enabled AND NOT is_service_user AND role = 'user' AND can_change_password
   AND must_change_password AND last_active_at IS NULL AND cardinality(server_permissions) = 0
   AND api_key_hash IS NULL
   AND NOT EXISTS (SELECT 1 FROM auth_sessions WHERE user_id = app_users.id)
   AND NOT EXISTS (SELECT 1 FROM department_memberships m JOIN contacts c ON c.id = m.contact_id
                   WHERE m.user_id = app_users.id AND c.archived_at IS NOT NULL)
   AND EXISTS (SELECT 1 FROM department_memberships WHERE user_id = app_users.id)) AS eligible
  FROM app_users`;
const userParams = { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } as const;
const setupBody = {
  body: {
    type: "object", required: ["setupCode", "password"], additionalProperties: false,
    properties: {
      setupCode: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" },
      password: { type: "string", minLength: 12, maxLength: 128 },
    },
  },
} as const;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const accountDigest = (account: Account) => digest(JSON.stringify([account.username, account.email, account.password_hash, account.membership_scope]));

export function registerAccountSetupInvitations(app: FastifyInstance, dependencies: {
  pool: () => Pool | null;
  authorize: (request: FastifyRequest, reply: FastifyReply, mutate: boolean) => string | null;
  resolveSiteAdminLocation: (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>;
  hashPassword: (password: string) => string;
  lockDepartment: (client: PoolClient, departmentId: string) => Promise<boolean>;
  writeLock: string;
}) {
  async function lockAccount(client: PoolClient, userId: string) {
    await client.query(dependencies.writeLock);
    // Re-read after locking so eligibility reflects concurrent account edits.
    await client.query("SELECT id FROM app_users WHERE id = $1 FOR UPDATE", [userId]);
    await client.query(
      `SELECT c.id FROM contacts c JOIN department_memberships m ON m.contact_id = c.id
       WHERE m.user_id = $1 ORDER BY c.id FOR SHARE OF c`, [userId],
    );
    return (await client.query<Account>(`${accounts} WHERE id = $1`, [userId])).rows[0];
  }

  async function lockMembershipLocations(client: PoolClient, userId: string) {
    const { rows } = await client.query<{ department_id: string }>("SELECT department_id FROM department_memberships WHERE user_id = $1 ORDER BY department_id", [userId]);
    for (const row of rows) if (!await dependencies.lockDepartment(client, row.department_id)) return false;
    return rows.length > 0;
  }

  async function isCurrentAdministrator(client: PoolClient, userId: string) {
    const { rows } = await client.query<{ id: string; displayName: string }>(
      `SELECT id, display_name AS "displayName" FROM app_users WHERE id = $1 AND role = 'server_admin' AND is_enabled AND NOT is_service_user`,
      [userId],
    );
    return rows[0];
  }

  async function issueInvitation(client: PoolClient, account: Account, actor: string) {
    const setupCode = randomBytes(32).toString("base64url");
    await client.query(
      `UPDATE account_setup_invitations SET revoked_at = now(), revoked_by = $2
       WHERE user_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL`,
      [account.id, actor],
    );
    const { rows: [invitation] } = await client.query<{ issuedAt: Date; expiresAt: Date }>(
      `INSERT INTO account_setup_invitations (id, user_id, issued_by, token_digest, credential_digest, issued_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, statement_timestamp(), statement_timestamp() + interval '14 days')
       RETURNING issued_at AS "issuedAt", expires_at AS "expiresAt"`,
      [randomUUID(), account.id, actor, digest(setupCode), accountDigest(account)],
    );
    return { ...invitation, status: "pending" as const, setupCode };
  }

  app.post<{ Params: { id: string }; Body: { username: string; role: "member" } }>("/api/contacts/:id/onboard-account", {
    schema: {
      ...userParams,
      body: {
        type: "object", required: ["username", "role"], additionalProperties: false,
        properties: {
          username: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$" },
          role: { type: "string", enum: ["member"] },
        },
      },
    },
  }, async (request, reply) => {
    const actorId = dependencies.authorize(request, reply, true);
    if (!actorId) return reply;
    const pool = dependencies.pool();
    if (!pool) return reply.code(503).send({ error: "The account database is unavailable." });
    const departmentId = await dependencies.resolveSiteAdminLocation(request, reply);
    if (!departmentId) return reply;
    const username = request.body.username.toLowerCase();
    reply.header("Cache-Control", "private, no-store");

    try {
      const outcome = await transaction(pool, async (client) => {
        await client.query(dependencies.writeLock);
        const actor = await isCurrentAdministrator(client, actorId);
        if (!actor || !await lockLocationAccessAdministrator(client, departmentId, actorId)) return "denied";
        if (!await dependencies.lockDepartment(client, departmentId)) return "standby";

        const { rows: [person] } = await client.query<{ first_name: string; last_name: string }>(
          "SELECT first_name, last_name FROM contacts WHERE id = $1 AND department_id = $2 AND archived_at IS NULL FOR UPDATE",
          [request.params.id, departmentId],
        );
        if (!person) return "missing";
        const linked = await client.query("SELECT 1 FROM department_memberships WHERE department_id = $1 AND contact_id = $2",
          [departmentId, request.params.id]);
        if (linked.rowCount) return "linked";
        const loginConflict = await client.query("SELECT 1 FROM app_users WHERE lower(username) = $1 OR lower(email) = $1", [username]);
        if (loginConflict.rowCount) return "username";

        const id = randomUUID();
        const { rows: [target] } = await client.query<{ id: string; displayName: string }>(
          `INSERT INTO app_users (id, username, display_name, first_name, last_name, password_hash, role, must_change_password)
           VALUES ($1, $2, left(concat_ws(' ', $3::text, $4::text), 100), $3, $4, $5, 'user', true)
           RETURNING id, display_name AS "displayName"`,
          [id, username, person.first_name, person.last_name, dependencies.hashPassword(randomBytes(32).toString("base64url"))],
        );
        await client.query(
          `INSERT INTO department_memberships (user_id, department_id, role, contact_id, permissions, video_permissions, presenter_permissions, module_permissions)
           VALUES ($1, $2, 'member', $3, '{}', '{}', '{}', '{}'::jsonb)`,
          [id, departmentId, request.params.id],
        );
        const { rows: [account] } = await client.query<Account>(`${accounts} WHERE id = $1`, [id]);
        if (!account?.eligible) throw new Error("The new linked account is not eligible for setup.");
        const invitation = await issueInvitation(client, account, actorId);
        await recordLocationAccessChanges(client, actor, target, "server_accounts", [], await readLocationAccessGrants(client, id, departmentId));
        return { id, username, invitation };
      });

      if (outcome === "denied") return reply.code(403).send({ error: "Server and site administrator access are required." });
      if (outcome === "standby") return reply.code(423).send({ error: "This location is read-only." });
      if (outcome === "missing") return reply.code(404).send({ error: "This active person could not be found in the selected location." });
      if (outcome === "linked") return reply.code(409).send({ error: "This person already has a linked account at this location." });
      if (outcome === "username") return reply.code(409).send({ error: "Choose a username that is not already used for sign-in." });
      return reply.code(201).send(outcome);
    } catch (error) {
      const constraint = (error as { code?: string; constraint?: string })?.constraint;
      if ((error as { code?: string })?.code === "23505" && constraint === "app_users_username_lower_idx") {
        return reply.code(409).send({ error: "Choose a username that is not already used for sign-in." });
      }
      throw error;
    }
  });

  async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  const adminRoute = "/api/users/:id/setup-invitation";
  app.get<{ Params: { id: string } }>(adminRoute, { schema: userParams }, async (request, reply) => {
    if (!dependencies.authorize(request, reply, false)) return reply;
    const pool = dependencies.pool();
    if (!pool) return reply.code(503).send({ error: "The account database is unavailable." });
    const { rows: [account] } = await pool.query<Account>(`${accounts} WHERE id = $1`, [request.params.id]);
    if (!account) return reply.code(404).send({ error: "This local user could not be found." });
    const { rows: [invitation] } = await pool.query(
      `SELECT issued_at AS "issuedAt", expires_at AS "expiresAt",
              CASE WHEN accepted_at IS NOT NULL THEN 'accepted' WHEN revoked_at IS NOT NULL THEN 'revoked'
                   WHEN expires_at <= now() THEN 'expired' WHEN NOT $2::boolean OR credential_digest <> $3 THEN 'invalidated'
                   ELSE 'pending' END AS status
       FROM account_setup_invitations WHERE user_id = $1 ORDER BY issued_at DESC, id DESC LIMIT 1`,
      [account.id, account.eligible, accountDigest(account)],
    );
    reply.header("Cache-Control", "private, no-store");
    return { eligible: account.eligible, invitation: invitation ?? null };
  });

  app.post<{ Params: { id: string } }>(adminRoute, { schema: userParams }, async (request, reply) => {
    const actor = dependencies.authorize(request, reply, true);
    if (!actor) return reply;
    const pool = dependencies.pool();
    if (!pool) return reply.code(503).send({ error: "The account database is unavailable." });
    const outcome = await transaction(pool, async (client) => {
      const account = await lockAccount(client, request.params.id);
      if (!await isCurrentAdministrator(client, actor)) return "denied";
      if (!account?.eligible) return null;
      if (!await lockMembershipLocations(client, account.id)) return false;
      return issueInvitation(client, account, actor);
    });
    reply.header("Cache-Control", "private, no-store");
    if (outcome === "denied") return reply.code(403).send({ error: "A Server Administrator session is required." });
    if (outcome === false) return reply.code(423).send({ error: "A location linked to this account is read-only." });
    if (!outcome) return reply.code(409).send({ error: "This account is not eligible for an initial setup link." });
    return reply.code(201).send(outcome);
  });

  app.delete<{ Params: { id: string } }>(adminRoute, { schema: userParams }, async (request, reply) => {
    const actor = dependencies.authorize(request, reply, true);
    if (!actor) return reply;
    const pool = dependencies.pool();
    if (!pool) return reply.code(503).send({ error: "The account database is unavailable." });
    const revoked = await transaction(pool, async (client) => {
      await lockAccount(client, request.params.id);
      if (!await isCurrentAdministrator(client, actor)) return false;
      await client.query(
        `UPDATE account_setup_invitations SET revoked_at = now(), revoked_by = $2
         WHERE user_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL`,
        [request.params.id, actor],
      );
      return true;
    });
    if (!revoked) return reply.code(403).send({ error: "A Server Administrator session is required." });
    return reply.code(204).send();
  });

  app.post<{ Body: { setupCode: string; password: string } }>("/api/auth/accept-setup-invitation", { schema: setupBody }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const pool = dependencies.pool();
    if (!pool) return reply.code(503).send({ error: "The account database is unavailable." });
    const tokenDigest = digest(request.body.setupCode);
    const { rows: [candidate] } = await pool.query<{ user_id: string }>(
      "SELECT user_id FROM account_setup_invitations WHERE token_digest = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()",
      [tokenDigest],
    );
    const accepted = candidate && await transaction(pool, async (client) => {
      const account = await lockAccount(client, candidate.user_id);
      if (!account?.eligible || !await lockMembershipLocations(client, account.id)) return false;
      const { rowCount } = await client.query(
        `UPDATE account_setup_invitations SET accepted_at = now()
         WHERE token_digest = $1 AND credential_digest = $2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
        [tokenDigest, accountDigest(account)],
      );
      if (!rowCount) return false;
      await client.query("UPDATE app_users SET password_hash = $2, must_change_password = false WHERE id = $1",
        [account.id, dependencies.hashPassword(request.body.password)]);
      return true;
    });
    if (!accepted) return reply.code(400).send({ error: "This setup link is unavailable. Ask your administrator for a new link." });
    return reply.code(204).send();
  });
}
