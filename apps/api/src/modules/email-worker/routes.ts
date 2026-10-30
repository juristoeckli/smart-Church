import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";
import { decryptEmailSecret, encryptEmailSecret, readDepartmentEmailSettings, saveDepartmentEmailSettings, type EmailSettingsDraft } from "./service.js";
import { registerSelfSignupRoutes } from "./self-signup.js";

type EmailSnapshot = {
  version: 4;
  emailSettings: Array<Record<string, unknown>>;
};

async function collectEmailSnapshot(client: Pick<PoolClient, "query">, departmentId: string): Promise<EmailSnapshot> {
  const emailSettings = await client.query(`SELECT mode,enabled,from_name,from_email,smtp_host,smtp_port,smtp_security,smtp_username,encrypted_smtp_password,updated_at
    FROM email_worker_department_settings WHERE department_id=$1
    UNION ALL
    SELECT settings.mode,settings.enabled,settings.from_name,settings.from_email,settings.smtp_host,settings.smtp_port,settings.smtp_security,settings.smtp_username,settings.encrypted_smtp_password,settings.updated_at
      FROM departments department JOIN installation_email_settings settings ON settings.installation_id=department.installation_id
     WHERE department.id=$1 AND NOT EXISTS(SELECT 1 FROM email_worker_department_settings WHERE department_id=$1)
    UNION ALL
    SELECT 'direct'::text,false,'Smart Church'::text,''::text,''::text,587,'starttls'::text,''::text,NULL::text,'1970-01-01T00:00:00Z'::timestamptz
     WHERE NOT EXISTS(SELECT 1 FROM email_worker_department_settings WHERE department_id=$1)
       AND NOT EXISTS(SELECT 1 FROM departments department JOIN installation_email_settings settings ON settings.installation_id=department.installation_id WHERE department.id=$1)`, [departmentId]);
  return { version: 4, emailSettings: emailSettings.rows };
}

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
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

function publicSettings(settings: Awaited<ReturnType<typeof readDepartmentEmailSettings>>) {
  const { encryptedSmtpPassword, ...safe } = settings;
  return safe;
}

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  async function selectedEmailDepartment(request: { headers: Record<string, string | string[] | undefined> }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
    const header = request.headers["x-department-id"];
    const departmentId = typeof header === "string" ? header : context.getDefaultDepartmentId();
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(departmentId)) {
      reply.code(400).send({ error: "Choose a valid location." });
      return null;
    }
    const exists = await context.pool!.query("SELECT 1 FROM departments WHERE id=$1 AND installation_id=(SELECT id FROM installations WHERE is_current=TRUE)", [departmentId]);
    if (!exists.rowCount) {
      reply.code(404).send({ error: "The selected location was not found on this server." });
      return null;
    }
    return departmentId;
  }
  context.replication.register({
    schemaVersion: "4",
    getSchemaVersion: async () => "4",
    inspect: async (departmentId) => {
      if (!context.pool || !context.isDatabaseReady()) return { ready: false, blockers: ["Email settings database is unavailable."], recordCount: 0 };
      try {
        const snapshot = await collectEmailSnapshot(context.pool, departmentId);
        const blockers: string[] = [];
        const signupState = await context.pool.query<{ enabled: boolean; request_count: string }>(
          `SELECT COALESCE((SELECT settings.enabled FROM installation_self_signup_settings settings
                              JOIN installations installation ON installation.id=settings.installation_id
                             WHERE installation.is_current=TRUE),FALSE) AS enabled,
                  (SELECT count(*)::text FROM self_signup_requests) AS request_count`,
        );
        if (signupState.rows[0]?.enabled || Number(signupState.rows[0]?.request_count ?? 0) > 0) {
          blockers.push("Self-sign-up settings or requests are installation-wide and are not included in per-site recovery. Disable self sign-up and clear its request queue before enabling redundancy for this location.");
        }
        if (snapshot.emailSettings[0]?.enabled && !await context.email.isConfigured(departmentId)) blockers.push("Email delivery is enabled but credentials are unavailable on this server; reconfigure them locally before promotion.");
        for (const row of snapshot.emailSettings) {
          if (typeof row.encrypted_smtp_password === "string" && row.encrypted_smtp_password.length > 0) {
            try { decryptEmailSecret(row.encrypted_smtp_password); }
            catch { blockers.push("SMTP credentials cannot be decrypted with this server's email encryption key."); break; }
          }
        }
        if (Buffer.byteLength(JSON.stringify(snapshot)) > 50 * 1024 * 1024) blockers.push("Email settings exceed the 50 MiB snapshot limit.");
        return { ready: blockers.length === 0, blockers, recordCount: snapshot.emailSettings.length };
      } catch (error) {
        return { ready: false, blockers: [error instanceof Error ? error.message.slice(0, 240) : "Email Delivery replication readiness could not be checked."], recordCount: 0 };
      }
    },
    exportSnapshot: (client: PoolClient, departmentId) => collectEmailSnapshot(client, departmentId),
    prepareSnapshotForPeer: async (input, sealForPeer) => {
      const snapshot = input as EmailSnapshot;
      const protectedSnapshot: EmailSnapshot & { credentialTransferVersion?: number } = structuredClone(snapshot);
      for (const row of protectedSnapshot.emailSettings) {
        if (typeof row.encrypted_smtp_password === "string" && row.encrypted_smtp_password.length) {
          row.encrypted_smtp_password = { sealedCredential: sealForPeer(decryptEmailSecret(row.encrypted_smtp_password)) };
        }
      }
      protectedSnapshot.credentialTransferVersion = 1;
      return protectedSnapshot;
    },
    restoreSnapshotFromPeer: async (input, openForLocal) => {
      const snapshot = input as EmailSnapshot & { credentialTransferVersion?: number };
      if (snapshot.credentialTransferVersion !== 1) return input;
      const restored: EmailSnapshot = structuredClone(snapshot);
      for (const row of restored.emailSettings) {
        const value = row.encrypted_smtp_password;
        if (value && typeof value === "object" && "sealedCredential" in value && typeof value.sealedCredential === "string") row.encrypted_smtp_password = encryptEmailSecret(openForLocal(value.sealedCredential));
        else if (typeof value === "string" && value.length) throw new Error("The SMTP password was not protected for this standby server.");
      }
      return restored;
    },
    restoreSnapshot: async (client, departmentId, input) => {
      const snapshot = input as Partial<EmailSnapshot>;
      if (!snapshot || snapshot.version !== 4 || !Array.isArray(snapshot.emailSettings) || snapshot.emailSettings.length > 1) throw new Error("The Email Delivery snapshot is invalid or exceeds supported limits.");
      if (snapshot.emailSettings[0]) {
        const row = snapshot.emailSettings[0];
        await client.query(`INSERT INTO email_worker_department_settings(department_id,mode,enabled,from_name,from_email,smtp_host,smtp_port,smtp_security,smtp_username,encrypted_smtp_password,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          ON CONFLICT(department_id) DO UPDATE SET mode=EXCLUDED.mode,enabled=EXCLUDED.enabled,from_name=EXCLUDED.from_name,from_email=EXCLUDED.from_email,smtp_host=EXCLUDED.smtp_host,smtp_port=EXCLUDED.smtp_port,smtp_security=EXCLUDED.smtp_security,smtp_username=EXCLUDED.smtp_username,encrypted_smtp_password=EXCLUDED.encrypted_smtp_password,updated_at=EXCLUDED.updated_at`,
        [departmentId,row.mode,row.enabled,row.from_name,row.from_email,row.smtp_host,row.smtp_port,row.smtp_security,row.smtp_username,row.encrypted_smtp_password,row.updated_at]);
      } else await client.query("DELETE FROM email_worker_department_settings WHERE department_id=$1", [departmentId]);
      return { recordCount: snapshot.emailSettings.length };
    },
    verifySnapshot: async (client, departmentId, input) => {
      if (!input || typeof input !== "object" || (input as Partial<EmailSnapshot>).version !== 4 || !Array.isArray((input as Partial<EmailSnapshot>).emailSettings)) return { ready: false, blockers: ["No supported Email Delivery snapshot is available."] };
      const comparable = (rows: Array<Record<string, unknown>>) => rows.map((row) => ({ ...row, encrypted_smtp_password: typeof row.encrypted_smtp_password === "string" && row.encrypted_smtp_password.length ? decryptEmailSecret(row.encrypted_smtp_password) : null })).map(canonical).sort();
      const expected = comparable((input as EmailSnapshot).emailSettings);
      const actual = comparable((await collectEmailSnapshot(client, departmentId)).emailSettings);
      return expected.length === actual.length && expected.every((row, index) => row === actual[index])
        ? { ready: true, blockers: [] }
        : { ready: false, blockers: ["Location email settings differ from the verified snapshot."] };
    },
  });

  registerSelfSignupRoutes(app, context);
  app.get("/api/modules/email-worker/settings", async (request, reply) => {
    if (request.authenticatedUser?.role !== "server_admin") return reply.code(403).send({ error: "Server administrator access is required." });
    if (!context.pool || !context.isDatabaseReady()) return reply.code(503).send({ error: "The settings database is unavailable." });
    const departmentId = await selectedEmailDepartment(request, reply);
    if (!departmentId) return reply;
    return publicSettings(await readDepartmentEmailSettings(context.pool, departmentId));
  });

  app.put<{ Body: EmailSettingsDraft }>("/api/modules/email-worker/settings", { schema: settingsSchema }, async (request, reply) => {
    if (request.authenticatedUser?.role !== "server_admin") return reply.code(403).send({ error: "Server administrator access is required." });
    if (!context.validateMutation(request, reply)) return reply;
    if (!context.pool || !context.isDatabaseReady()) return reply.code(503).send({ error: "The settings database is unavailable." });
    const departmentId = await selectedEmailDepartment(request, reply);
    if (!departmentId) return reply;
    if (!await context.isDepartmentWritable(departmentId)) return reply.code(423).send({ error: "Email settings are read-only while this location is in standby or fenced state." });
    const { body } = request;
    if (body.enabled && !body.fromEmail.trim()) return reply.code(400).send({ error: "Enter the sender email address before enabling email delivery." });
    if (body.enabled && !body.fromName.trim()) return reply.code(400).send({ error: "Enter the sender name before enabling email delivery." });
    if (body.fromEmail && !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(body.fromEmail.trim())) return reply.code(400).send({ error: "Enter a valid sender email address." });
    if (body.mode === "smtp" && body.enabled && !body.smtpHost.trim()) return reply.code(400).send({ error: "Enter the SMTP server host." });
    await saveDepartmentEmailSettings(context.pool, departmentId, body);
    return publicSettings(await readDepartmentEmailSettings(context.pool, departmentId));
  });
}
