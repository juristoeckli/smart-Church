import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext, ReplicationRestoreContext } from "../module-sdk.js";
import { decryptEmailSecret, encryptEmailSecret, readDepartmentEmailSettings, saveDepartmentEmailSettings, type EmailSettingsDraft } from "./service.js";
import { registerSelfSignupRoutes } from "./self-signup.js";

type EmailSnapshot = { version: 5; emailSettings: Array<Record<string, unknown>>; signupSettings: Array<Record<string, unknown>>; signupRequests: Array<Record<string, unknown>> };

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
  const signupSettings = await client.query("SELECT enabled,confirmation_delay_minutes,updated_at FROM department_self_signup_settings WHERE department_id=$1", [departmentId]);
  const signupRequests = await client.query(`SELECT id,email,first_name,last_name,phone,street,street_number,postal_code,city,username,status,initial_token_hash,initial_expires_at,initial_requested_at,confirmation_token_hash,confirmation_origin,confirmation_available_at,confirmation_expires_at,confirmation_sent_at,confirmation_attempts,next_confirmation_attempt_at,email_confirmed_at,account_user_id,last_error,created_at,updated_at,reviewed_at,reviewed_by,language,expiry_notification_attempts,next_expiry_notification_at FROM self_signup_requests WHERE department_id=$1 ORDER BY id`, [departmentId]);
  return { version: 5, emailSettings: emailSettings.rows, signupSettings: signupSettings.rows, signupRequests: signupRequests.rows };
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
    schemaVersion: "5",
    getSchemaVersion: async () => "5",
    inspect: async (departmentId) => {
      if (!context.pool || !context.isDatabaseReady()) return { ready: false, blockers: ["Email settings database is unavailable."], recordCount: 0 };
      try {
        const snapshot = await collectEmailSnapshot(context.pool, departmentId);
        const blockers: string[] = [];
        if (snapshot.signupSettings.length > 1) blockers.push("This site has duplicate self sign-up settings rows.");
        if (snapshot.signupRequests.length > 10_000) blockers.push("This site's sign-up queue exceeds the 10,000 request snapshot limit.");
        if (snapshot.emailSettings[0]?.enabled && !await context.email.isConfigured(departmentId)) blockers.push("Email delivery is enabled but credentials are unavailable on this server; reconfigure them locally before promotion.");
        for (const row of snapshot.emailSettings) {
          if (typeof row.encrypted_smtp_password === "string" && row.encrypted_smtp_password.length > 0) {
            try { decryptEmailSecret(row.encrypted_smtp_password); }
            catch { blockers.push("SMTP credentials cannot be decrypted with this server's email encryption key."); break; }
          }
        }
        if (Buffer.byteLength(JSON.stringify(snapshot)) > 50 * 1024 * 1024) blockers.push("Email settings exceed the 50 MiB snapshot limit.");
        return { ready: blockers.length === 0, blockers, recordCount: snapshot.emailSettings.length + snapshot.signupSettings.length + snapshot.signupRequests.length };
      } catch (error) {
        return { ready: false, blockers: [error instanceof Error ? error.message.slice(0, 240) : "Email Delivery replication readiness could not be checked."], recordCount: 0 };
      }
    },
    exportSnapshot: (client: PoolClient, departmentId) => collectEmailSnapshot(client, departmentId),
    prepareSnapshotForPeer: async (input, sealForPeer) => {
      const snapshot = input as EmailSnapshot;
      const protectedSnapshot: EmailSnapshot & { credentialTransferVersion?: number; signupRequestEnvelopes?: string[] } = structuredClone(snapshot);
      for (const row of protectedSnapshot.emailSettings) {
        if (typeof row.encrypted_smtp_password === "string" && row.encrypted_smtp_password.length) {
          row.encrypted_smtp_password = { sealedCredential: sealForPeer(decryptEmailSecret(row.encrypted_smtp_password)) };
        }
      }
      protectedSnapshot.signupRequestEnvelopes = protectedSnapshot.signupRequests.map((row) => sealForPeer(JSON.stringify(row)));
      protectedSnapshot.signupRequests = [];
      protectedSnapshot.credentialTransferVersion = 1;
      return protectedSnapshot;
    },
    restoreSnapshotFromPeer: async (input, openForLocal) => {
      const snapshot = input as EmailSnapshot & { credentialTransferVersion?: number; signupRequestEnvelopes?: string[] };
      if (snapshot.credentialTransferVersion !== 1) return input;
      const restored: EmailSnapshot = structuredClone(snapshot);
      for (const row of restored.emailSettings) {
        const value = row.encrypted_smtp_password;
        if (value && typeof value === "object" && "sealedCredential" in value && typeof value.sealedCredential === "string") row.encrypted_smtp_password = encryptEmailSecret(openForLocal(value.sealedCredential));
        else if (typeof value === "string" && value.length) throw new Error("The SMTP password was not protected for this standby server.");
      }
      if (!Array.isArray(snapshot.signupRequestEnvelopes) || snapshot.signupRequestEnvelopes.length > 10_000) throw new Error("The protected self sign-up queue is invalid or exceeds supported limits.");
      restored.signupRequests = snapshot.signupRequestEnvelopes.map((envelope) => {
        if (typeof envelope !== "string" || envelope.length > 65_536) throw new Error("A protected self sign-up request is invalid or exceeds the envelope limit.");
        const row = JSON.parse(openForLocal(envelope)) as Record<string, unknown>;
        if (!row || typeof row.id !== "string" || typeof row.email !== "string") throw new Error("A protected self sign-up request is invalid.");
        return row;
      });
      return restored;
    },
    restoreSnapshot: async (client, departmentId, input, restoreContext) => {
      const snapshot = input as Partial<EmailSnapshot>;
      if (!snapshot || snapshot.version !== 5 || !Array.isArray(snapshot.emailSettings) || snapshot.emailSettings.length > 1 || !Array.isArray(snapshot.signupSettings) || snapshot.signupSettings.length > 1 || !Array.isArray(snapshot.signupRequests) || snapshot.signupRequests.length > 10_000) throw new Error("The Email Delivery snapshot is invalid or exceeds supported limits.");
      if (snapshot.emailSettings[0]) {
        const row = snapshot.emailSettings[0];
        await client.query(`INSERT INTO email_worker_department_settings(department_id,mode,enabled,from_name,from_email,smtp_host,smtp_port,smtp_security,smtp_username,encrypted_smtp_password,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          ON CONFLICT(department_id) DO UPDATE SET mode=EXCLUDED.mode,enabled=EXCLUDED.enabled,from_name=EXCLUDED.from_name,from_email=EXCLUDED.from_email,smtp_host=EXCLUDED.smtp_host,smtp_port=EXCLUDED.smtp_port,smtp_security=EXCLUDED.smtp_security,smtp_username=EXCLUDED.smtp_username,encrypted_smtp_password=EXCLUDED.encrypted_smtp_password,updated_at=EXCLUDED.updated_at`,
        [departmentId,row.mode,row.enabled,row.from_name,row.from_email,row.smtp_host,row.smtp_port,row.smtp_security,row.smtp_username,row.encrypted_smtp_password,row.updated_at]);
      } else await client.query("DELETE FROM email_worker_department_settings WHERE department_id=$1", [departmentId]);
      if (snapshot.signupSettings[0]) {
        const row = snapshot.signupSettings[0];
        await client.query(`INSERT INTO department_self_signup_settings(department_id,enabled,confirmation_delay_minutes,updated_at) VALUES($1,$2,$3,$4)
          ON CONFLICT(department_id) DO UPDATE SET enabled=EXCLUDED.enabled,confirmation_delay_minutes=EXCLUDED.confirmation_delay_minutes,updated_at=EXCLUDED.updated_at`, [departmentId,row.enabled,row.confirmation_delay_minutes,row.updated_at]);
      } else await client.query("DELETE FROM department_self_signup_settings WHERE department_id=$1", [departmentId]);
      await client.query("DELETE FROM self_signup_requests WHERE department_id=$1", [departmentId]);
      for (const row of snapshot.signupRequests) {
        const accountUserId = typeof row.account_user_id === "string" ? restoreContext.userIdMap.get(row.account_user_id) ?? row.account_user_id : null;
        const reviewedBy = typeof row.reviewed_by === "string" ? restoreContext.userIdMap.get(row.reviewed_by) ?? row.reviewed_by : null;
        await client.query(`INSERT INTO self_signup_requests(id,email,department_id,first_name,last_name,phone,street,street_number,postal_code,city,username,status,initial_token_hash,initial_expires_at,initial_requested_at,confirmation_token_hash,confirmation_origin,confirmation_available_at,confirmation_expires_at,confirmation_sent_at,confirmation_attempts,next_confirmation_attempt_at,email_confirmed_at,account_user_id,last_error,created_at,updated_at,reviewed_at,reviewed_by,language,expiry_notification_attempts,next_expiry_notification_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)`,
        [row.id,row.email,departmentId,row.first_name,row.last_name,row.phone,row.street,row.street_number,row.postal_code,row.city,row.username,row.status,row.initial_token_hash,row.initial_expires_at,row.initial_requested_at,row.confirmation_token_hash,row.confirmation_origin,row.confirmation_available_at,row.confirmation_expires_at,row.confirmation_sent_at,row.confirmation_attempts,row.next_confirmation_attempt_at,row.email_confirmed_at,accountUserId,row.last_error,row.created_at,row.updated_at,row.reviewed_at,reviewedBy,row.language,row.expiry_notification_attempts,row.next_expiry_notification_at]);
      }
      return { recordCount: snapshot.emailSettings.length + snapshot.signupSettings.length + snapshot.signupRequests.length };
    },
    verifySnapshot: async (client, departmentId, input, restoreContext?: ReplicationRestoreContext) => {
      if (!input || typeof input !== "object" || (input as Partial<EmailSnapshot>).version !== 5 || !Array.isArray((input as Partial<EmailSnapshot>).emailSettings) || !Array.isArray((input as Partial<EmailSnapshot>).signupRequests)) return { ready: false, blockers: ["No supported Email Delivery snapshot is available."] };
      const comparable = (rows: Array<Record<string, unknown>>) => rows.map((row) => ({ ...row, encrypted_smtp_password: typeof row.encrypted_smtp_password === "string" && row.encrypted_smtp_password.length ? decryptEmailSecret(row.encrypted_smtp_password) : null })).map(canonical).sort();
      const expected = comparable((input as EmailSnapshot).emailSettings);
      const expectedSnapshot = input as EmailSnapshot;
      const actualSnapshot = await collectEmailSnapshot(client, departmentId);
      const expectedSignup = canonical({ settings: expectedSnapshot.signupSettings, requests: expectedSnapshot.signupRequests.map((row) => ({ ...row, department_id: departmentId, account_user_id: typeof row.account_user_id === "string" ? restoreContext?.userIdMap.get(row.account_user_id) ?? row.account_user_id : null, reviewed_by: typeof row.reviewed_by === "string" ? restoreContext?.userIdMap.get(row.reviewed_by) ?? row.reviewed_by : null })) });
      const actualSignup = canonical({ settings: actualSnapshot.signupSettings, requests: actualSnapshot.signupRequests });
      const actual = comparable(actualSnapshot.emailSettings);
      return expected.length === actual.length && expected.every((row, index) => row === actual[index]) && expectedSignup === actualSignup
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
