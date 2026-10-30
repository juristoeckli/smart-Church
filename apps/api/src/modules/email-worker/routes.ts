import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";
import { emailEncryptionKeyFingerprint, readEmailSettings, saveEmailSettings, type EmailSettingsDraft } from "./service.js";
import { emailModuleInstallationWritable, registerSelfSignupRoutes } from "./self-signup.js";

type EmailSnapshot = {
  version: 2;
  encryptionKeyFingerprint: string | null;
  emailSettings: Array<Record<string, unknown>>;
  selfSignupSettings: Array<Record<string, unknown>>;
  selfSignupRequests: Array<Record<string, unknown>>;
};

async function collectEmailSnapshot(client: Pick<PoolClient, "query">, departmentId: string): Promise<EmailSnapshot> {
  const department = await client.query<{ installation_id: string }>("SELECT installation_id FROM departments WHERE id=$1", [departmentId]);
  if (!department.rows[0]?.installation_id) throw new Error("The site's installation could not be determined for Email Delivery replication.");
  const installationId = department.rows[0].installation_id;
  const [emailSettings, selfSignupSettings, selfSignupRequests] = await Promise.all([
    client.query("SELECT mode,enabled,from_name,from_email,smtp_host,smtp_port,smtp_security,smtp_username,encrypted_smtp_password,updated_at FROM installation_email_settings WHERE installation_id=$1", [installationId]),
    client.query("SELECT enabled,confirmation_delay_minutes,updated_at FROM installation_self_signup_settings WHERE installation_id=$1", [installationId]),
    client.query(`SELECT id,email,language,first_name,last_name,phone,street,street_number,postal_code,city,username,status,initial_token_hash,initial_expires_at,initial_requested_at,confirmation_token_hash,confirmation_origin,confirmation_available_at,confirmation_expires_at,confirmation_sent_at,confirmation_attempts,next_confirmation_attempt_at,email_confirmed_at,account_user_id,last_error,created_at,updated_at,reviewed_at,reviewed_by FROM self_signup_requests ORDER BY id`),
  ]);
  const hasEncryptedPassword = emailSettings.rows.some((row) => typeof row.encrypted_smtp_password === "string" && row.encrypted_smtp_password.length > 0);
  let keyFingerprint: string | null = null;
  if (hasEncryptedPassword) {
    try { keyFingerprint = emailEncryptionKeyFingerprint(); }
    catch { keyFingerprint = "missing"; }
  }
  return { version: 2, encryptionKeyFingerprint: keyFingerprint, emailSettings: emailSettings.rows, selfSignupSettings: selfSignupSettings.rows, selfSignupRequests: selfSignupRequests.rows };
}

const settingsSchema = {
  body: {
    type: "object", additionalProperties: false,
    required: ["mode", "enabled", "fromName", "fromEmail", "smtpHost", "smtpPort", "smtpSecurity", "smtpUsername", "smtpPassword", "clearPassword"],
    properties: {
      mode: { type: "string", enum: ["direct", "smtp"] }, enabled: { type: "boolean" },
      fromName: { type: "string", maxLength: 120 }, fromEmail: { type: "string", maxLength: 254 },
      smtpHost: { type: "string", maxLength: 253 }, smtpPort: { type: "integer", minimum: 1, maximum: 65535 },
      smtpSecurity: { type: "string", enum: ["none", "starttls", "tls"] },
      smtpUsername: { type: "string", maxLength: 254 }, smtpPassword: { type: "string", maxLength: 500 }, clearPassword: { type: "boolean" },
    },
  },
};

function publicSettings(settings: Awaited<ReturnType<typeof readEmailSettings>>) {
  const { encryptedSmtpPassword, ...safe } = settings;
  return safe;
}

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  context.replication.register({
    schemaVersion: "2",
    getSchemaVersion: async () => "2",
    inspect: async (departmentId) => {
      if (!context.pool || !context.isDatabaseReady()) return { ready: false, blockers: ["Email settings database is unavailable."], recordCount: 0 };
      try {
        const blockers: string[] = [];
        const snapshot = await collectEmailSnapshot(context.pool, departmentId);
        const otherSites = await context.pool.query<{ count: string }>(`SELECT count(*)::text AS count
          FROM departments department
          JOIN installations installation ON installation.id=department.installation_id AND installation.is_current=TRUE
          WHERE department.installation_id=(SELECT installation_id FROM departments WHERE id=$1)
            AND department.id<>$1`, [departmentId]);
        if (Number(otherSites.rows[0]?.count ?? 0) > 0) blockers.push("Email settings and self-sign-up requests are installation-wide and would replace data used by other locations. Make Email Delivery data location-scoped before enabling redundancy for multiple locations.");
        const installation = await context.pool.query<{ enabled: boolean }>("SELECT COALESCE((SELECT enabled FROM installation_email_settings WHERE installation_id=(SELECT installation_id FROM departments WHERE id=$1)),false) AS enabled", [departmentId]);
        if (installation.rows[0]?.enabled && !await context.email.isConfigured()) blockers.push("Email delivery is enabled but credentials are unavailable on this server; reconfigure them locally before promotion.");
        const encryptedPassword = snapshot.emailSettings[0]?.encrypted_smtp_password;
        if (typeof encryptedPassword === "string" && encryptedPassword.length > 0 && snapshot.encryptionKeyFingerprint === "missing") blockers.push("Set SMART_CHURCH_EMAIL_ENCRYPTION_KEY before replicating SMTP credentials; the current encryption key is unavailable.");
        const referencedUsers = [...new Set(snapshot.selfSignupRequests.flatMap((row) => [row.account_user_id, row.reviewed_by]).filter((id): id is string => typeof id === "string"))];
        const replicatedUsers = referencedUsers.length
          ? new Set((await context.pool.query<{ id: string }>("SELECT user_id AS id FROM department_memberships WHERE department_id=$1 AND user_id=ANY($2::uuid[])", [departmentId, referencedUsers])).rows.map((row) => row.id))
          : new Set<string>();
        const unreplicatedAccounts = snapshot.selfSignupRequests.filter((row) =>
          (typeof row.account_user_id === "string" && !replicatedUsers.has(row.account_user_id))
          || (typeof row.reviewed_by === "string" && !replicatedUsers.has(row.reviewed_by)));
        if (unreplicatedAccounts.length) blockers.push(`${unreplicatedAccounts.length} self-sign-up request(s) reference accounts outside this site's replicated user set.`);
        const bytes = Buffer.byteLength(JSON.stringify(snapshot));
        if (bytes > 50 * 1024 * 1024) blockers.push("Email settings and self-sign-up history exceed the 50 MiB snapshot limit.");
        return { ready: !blockers.length, blockers, recordCount: snapshot.emailSettings.length + snapshot.selfSignupSettings.length + snapshot.selfSignupRequests.length };
      } catch (error) {
        return { ready: false, blockers: [error instanceof Error ? error.message.slice(0, 240) : "Email Delivery replication readiness could not be checked."], recordCount: 0 };
      }
    },
    exportSnapshot: (client: PoolClient, departmentId) => collectEmailSnapshot(client, departmentId),
    restoreSnapshot: async (client, departmentId, input, restoreContext) => {
      const snapshot = input as Partial<EmailSnapshot>;
      if (!snapshot || snapshot.version !== 2 || !Array.isArray(snapshot.emailSettings) || snapshot.emailSettings.length > 1 || !Array.isArray(snapshot.selfSignupSettings) || snapshot.selfSignupSettings.length > 1 || !Array.isArray(snapshot.selfSignupRequests) || snapshot.selfSignupRequests.length > 100000) throw new Error("The Email Delivery snapshot is invalid or exceeds supported limits.");
      const hasEncryptedPassword = snapshot.emailSettings.some((row) => typeof row.encrypted_smtp_password === "string" && row.encrypted_smtp_password.length > 0);
      if (hasEncryptedPassword) {
        let localFingerprint: string;
        try { localFingerprint = emailEncryptionKeyFingerprint(); }
        catch { throw new Error("Set SMART_CHURCH_EMAIL_ENCRYPTION_KEY on the standby before restoring SMTP credentials."); }
        if (!snapshot.encryptionKeyFingerprint || snapshot.encryptionKeyFingerprint === "missing" || localFingerprint !== snapshot.encryptionKeyFingerprint) throw new Error("SMART_CHURCH_EMAIL_ENCRYPTION_KEY does not match the primary; SMTP credentials cannot be restored safely.");
      }
      const department = await client.query<{ installation_id: string }>("SELECT installation_id FROM departments WHERE id=$1", [departmentId]);
      if (!department.rows[0]?.installation_id) throw new Error("The standby site's installation could not be determined for Email Delivery restore.");
      const installationId = department.rows[0].installation_id;
      if (snapshot.emailSettings[0]) {
        const row = snapshot.emailSettings[0];
        await client.query(`INSERT INTO installation_email_settings(installation_id,mode,enabled,from_name,from_email,smtp_host,smtp_port,smtp_security,smtp_username,encrypted_smtp_password,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(installation_id) DO UPDATE SET mode=EXCLUDED.mode,enabled=EXCLUDED.enabled,from_name=EXCLUDED.from_name,from_email=EXCLUDED.from_email,smtp_host=EXCLUDED.smtp_host,smtp_port=EXCLUDED.smtp_port,smtp_security=EXCLUDED.smtp_security,smtp_username=EXCLUDED.smtp_username,encrypted_smtp_password=EXCLUDED.encrypted_smtp_password,updated_at=EXCLUDED.updated_at`,
        [installationId,row.mode,row.enabled,row.from_name,row.from_email,row.smtp_host,row.smtp_port,row.smtp_security,row.smtp_username,row.encrypted_smtp_password,row.updated_at]);
      } else await client.query("DELETE FROM installation_email_settings WHERE installation_id=$1", [installationId]);
      if (snapshot.selfSignupSettings[0]) {
        const row = snapshot.selfSignupSettings[0];
        await client.query(`INSERT INTO installation_self_signup_settings(installation_id,enabled,confirmation_delay_minutes,updated_at) VALUES($1,$2,$3,$4)
          ON CONFLICT(installation_id) DO UPDATE SET enabled=EXCLUDED.enabled,confirmation_delay_minutes=EXCLUDED.confirmation_delay_minutes,updated_at=EXCLUDED.updated_at`,
        [installationId,row.enabled,row.confirmation_delay_minutes,row.updated_at]);
      } else await client.query("DELETE FROM installation_self_signup_settings WHERE installation_id=$1", [installationId]);
      await client.query("DELETE FROM self_signup_requests");
      for (const row of snapshot.selfSignupRequests) {
        const accountUserId = row.account_user_id == null ? null : restoreContext.userIdMap.get(String(row.account_user_id));
        const reviewedBy = row.reviewed_by == null ? null : restoreContext.userIdMap.get(String(row.reviewed_by));
        if (row.account_user_id != null && !accountUserId) throw new Error("A self-sign-up account has no matching user on the standby server.");
        if (row.reviewed_by != null && !reviewedBy) throw new Error("A self-sign-up reviewer has no matching user on the standby server.");
        await client.query(`INSERT INTO self_signup_requests(id,email,language,first_name,last_name,phone,street,street_number,postal_code,city,username,status,initial_token_hash,initial_expires_at,initial_requested_at,confirmation_token_hash,confirmation_origin,confirmation_available_at,confirmation_expires_at,confirmation_sent_at,confirmation_attempts,next_confirmation_attempt_at,email_confirmed_at,account_user_id,last_error,created_at,updated_at,reviewed_at,reviewed_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`,
        [row.id,row.email,row.language,row.first_name,row.last_name,row.phone,row.street,row.street_number,row.postal_code,row.city,row.username,row.status,row.initial_token_hash,row.initial_expires_at,row.initial_requested_at,row.confirmation_token_hash,row.confirmation_origin,row.confirmation_available_at,row.confirmation_expires_at,row.confirmation_sent_at,row.confirmation_attempts,row.next_confirmation_attempt_at,row.email_confirmed_at,accountUserId,row.last_error,row.created_at,row.updated_at,row.reviewed_at,reviewedBy]);
      }
      return { recordCount: snapshot.emailSettings.length + snapshot.selfSignupSettings.length + snapshot.selfSignupRequests.length };
    },
    verifySnapshot: async (client, departmentId, input, restoreContext) => {
      if (!input || typeof input !== "object" || (input as { version?: unknown }).version !== 2
        || !Array.isArray((input as Partial<EmailSnapshot>).emailSettings)
        || !Array.isArray((input as Partial<EmailSnapshot>).selfSignupSettings)
        || !Array.isArray((input as Partial<EmailSnapshot>).selfSignupRequests)) return { ready: false, blockers: ["No supported Email Delivery snapshot is available."] };
      const snapshot = input as EmailSnapshot;
      const actual = await collectEmailSnapshot(client, departmentId);
      const mapUser = (row: Record<string, unknown>) => ({ ...row,
        ...(row.account_user_id == null ? {} : { account_user_id: restoreContext?.userIdMap.get(String(row.account_user_id)) ?? row.account_user_id }),
        ...(row.reviewed_by == null ? {} : { reviewed_by: restoreContext?.userIdMap.get(String(row.reviewed_by)) ?? row.reviewed_by }),
      });
      const canonical = (value: unknown): string => {
        if (value instanceof Date) return JSON.stringify(value.toISOString());
        if (typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
          const date = new Date(value);
          if (!Number.isNaN(date.getTime())) return JSON.stringify(date.toISOString());
        }
        return Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}` : JSON.stringify(value);
      };
      const sameRows = (source: Array<Record<string, unknown>>, replica: Array<Record<string, unknown>>, map = false) => {
        if (source.length !== replica.length) return false;
        const expectedRows = source.map((row) => canonical(map ? mapUser(row) : row)).sort();
        const actualRows = replica.map(canonical).sort();
        return expectedRows.every((row, index) => row === actualRows[index]);
      };
      return sameRows(snapshot.emailSettings, actual.emailSettings) && sameRows(snapshot.selfSignupSettings, actual.selfSignupSettings) && sameRows(snapshot.selfSignupRequests, actual.selfSignupRequests, true)
        ? { ready: true, blockers: [] }
        : { ready: false, blockers: ["Email settings or self-sign-up data differ from the verified snapshot."] };
    },
  });
  registerSelfSignupRoutes(app, context);
  app.get("/api/modules/email-worker/settings", async (request, reply) => {
    if (request.authenticatedUser?.role !== "server_admin") return reply.code(403).send({ error: "Server administrator access is required." });
    if (!context.pool || !context.isDatabaseReady()) return reply.code(503).send({ error: "The settings database is unavailable." });
    const installation = await context.pool.query<{ id: string }>("SELECT id FROM installations WHERE is_current=true");
    if (!installation.rows[0]) return reply.code(503).send({ error: "The installation settings are unavailable." });
    return publicSettings(await readEmailSettings(context.pool, installation.rows[0].id));
  });

  app.put<{ Body: EmailSettingsDraft }>("/api/modules/email-worker/settings", { schema: settingsSchema }, async (request, reply) => {
    if (request.authenticatedUser?.role !== "server_admin") return reply.code(403).send({ error: "Server administrator access is required." });
    if (!context.validateMutation(request, reply)) return reply;
    if (!await emailModuleInstallationWritable(context)) return reply.code(423).send({ error: "Email settings are read-only while a location is in standby or fenced state." });
    if (!context.pool || !context.isDatabaseReady()) return reply.code(503).send({ error: "The settings database is unavailable." });
    const { body } = request;
    if (body.enabled && !body.fromEmail.trim()) return reply.code(400).send({ error: "Enter the sender email address before enabling email delivery." });
    if (body.enabled && !body.fromName.trim()) return reply.code(400).send({ error: "Enter the sender name before enabling email delivery." });
    if (body.fromEmail && !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(body.fromEmail.trim())) return reply.code(400).send({ error: "Enter a valid sender email address." });
    if (body.mode === "smtp" && body.enabled && !body.smtpHost.trim()) return reply.code(400).send({ error: "Enter the SMTP server host." });
    const installation = await context.pool.query<{ id: string }>("SELECT id FROM installations WHERE is_current=true");
    if (!installation.rows[0]) return reply.code(503).send({ error: "The installation settings are unavailable." });
    await saveEmailSettings(context.pool, installation.rows[0].id, body);
    return publicSettings(await readEmailSettings(context.pool, installation.rows[0].id));
  });
}
