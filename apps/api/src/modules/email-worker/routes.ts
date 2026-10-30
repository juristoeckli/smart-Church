import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";
import { emailEncryptionKeyFingerprint, readDepartmentEmailSettings, saveDepartmentEmailSettings, type EmailSettingsDraft } from "./service.js";
import { registerSelfSignupRoutes } from "./self-signup.js";

type EmailSnapshot = {
  version: 3;
  encryptionKeyFingerprint: string | null;
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
  const hasEncryptedPassword = emailSettings.rows.some((row) => typeof row.encrypted_smtp_password === "string" && row.encrypted_smtp_password.length > 0);
  let keyFingerprint: string | null = null;
  if (hasEncryptedPassword) {
    try { keyFingerprint = emailEncryptionKeyFingerprint(); }
    catch { keyFingerprint = "missing"; }
  }
  return { version: 3, encryptionKeyFingerprint: keyFingerprint, emailSettings: emailSettings.rows };
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
    schemaVersion: "3",
    getSchemaVersion: async () => "3",
    inspect: async (departmentId) => {
      if (!context.pool || !context.isDatabaseReady()) return { ready: false, blockers: ["Email settings database is unavailable."], recordCount: 0 };
      try {
        const snapshot = await collectEmailSnapshot(context.pool, departmentId);
        const blockers: string[] = [];
        if (snapshot.emailSettings[0]?.enabled && !await context.email.isConfigured(departmentId)) blockers.push("Email delivery is enabled but credentials are unavailable on this server; reconfigure them locally before promotion.");
        const encryptedPassword = snapshot.emailSettings[0]?.encrypted_smtp_password;
        if (typeof encryptedPassword === "string" && encryptedPassword.length > 0 && snapshot.encryptionKeyFingerprint === "missing") blockers.push("Set SMART_CHURCH_EMAIL_ENCRYPTION_KEY before replicating SMTP credentials; the current encryption key is unavailable.");
        if (Buffer.byteLength(JSON.stringify(snapshot)) > 50 * 1024 * 1024) blockers.push("Email settings exceed the 50 MiB snapshot limit.");
        return { ready: blockers.length === 0, blockers, recordCount: snapshot.emailSettings.length };
      } catch (error) {
        return { ready: false, blockers: [error instanceof Error ? error.message.slice(0, 240) : "Email Delivery replication readiness could not be checked."], recordCount: 0 };
      }
    },
    exportSnapshot: (client: PoolClient, departmentId) => collectEmailSnapshot(client, departmentId),
    restoreSnapshot: async (client, departmentId, input) => {
      const snapshot = input as Partial<EmailSnapshot>;
      if (!snapshot || snapshot.version !== 3 || !Array.isArray(snapshot.emailSettings) || snapshot.emailSettings.length > 1) throw new Error("The Email Delivery snapshot is invalid or exceeds supported limits.");
      const hasEncryptedPassword = snapshot.emailSettings.some((row) => typeof row.encrypted_smtp_password === "string" && row.encrypted_smtp_password.length > 0);
      if (hasEncryptedPassword) {
        let localFingerprint: string;
        try { localFingerprint = emailEncryptionKeyFingerprint(); }
        catch { throw new Error("Set SMART_CHURCH_EMAIL_ENCRYPTION_KEY on the standby before restoring SMTP credentials."); }
        if (!snapshot.encryptionKeyFingerprint || snapshot.encryptionKeyFingerprint === "missing" || localFingerprint !== snapshot.encryptionKeyFingerprint) throw new Error("SMART_CHURCH_EMAIL_ENCRYPTION_KEY does not match the primary; SMTP credentials cannot be restored safely.");
      }
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
      if (!input || typeof input !== "object" || (input as Partial<EmailSnapshot>).version !== 3 || !Array.isArray((input as Partial<EmailSnapshot>).emailSettings)) return { ready: false, blockers: ["No supported Email Delivery snapshot is available."] };
      const expected = (input as EmailSnapshot).emailSettings.map(canonical).sort();
      const actual = (await collectEmailSnapshot(client, departmentId)).emailSettings.map(canonical).sort();
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
