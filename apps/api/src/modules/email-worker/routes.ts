import type { FastifyInstance } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";
import { readEmailSettings, saveEmailSettings, type EmailSettingsDraft } from "./service.js";
import { registerSelfSignupRoutes } from "./self-signup.js";

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
    schemaVersion: "1",
    inspect: async () => {
      if (!context.pool || !context.isDatabaseReady()) return { ready: false, blockers: ["Email settings database is unavailable."], recordCount: 0 };
      const installation = await context.pool.query<{ enabled: boolean }>("SELECT COALESCE((SELECT enabled FROM installation_email_settings WHERE installation_id=(SELECT id FROM installations WHERE is_current=true)),false) AS enabled");
      const blockers: string[] = [];
      if (installation.rows[0]?.enabled && !await context.email.isConfigured()) blockers.push("Email delivery is enabled but credentials are unavailable on this server; reconfigure them locally before promotion.");
      const localWorkflows = await context.pool.query<{ signup_settings_exist: boolean; signup_requests_exist: boolean }>("SELECT to_regclass('public.installation_self_signup_settings') IS NOT NULL AS signup_settings_exist,to_regclass('public.self_signup_requests') IS NOT NULL AS signup_requests_exist");
      let pendingSignups = 0;
      if (localWorkflows.rows[0]?.signup_settings_exist) {
        const signupSettings = await context.pool.query<{ enabled: boolean }>("SELECT COALESCE((SELECT enabled FROM installation_self_signup_settings WHERE installation_id=(SELECT id FROM installations WHERE is_current=true)),false) AS enabled");
        if (signupSettings.rows[0]?.enabled) blockers.push("Self-sign-up is enabled in installation settings and is not replicated. Disable it or provision the same workflow on the standby before promotion.");
      }
      if (localWorkflows.rows[0]?.signup_requests_exist) {
        const requests = await context.pool.query<{ count: string }>("SELECT count(*)::text AS count FROM self_signup_requests WHERE status NOT IN ('approved','denied','expired')");
        pendingSignups = Number(requests.rows[0]?.count ?? 0);
        if (pendingSignups) blockers.push(`${pendingSignups} pending self-sign-up request${pendingSignups === 1 ? "" : "s"} is not replicated; resolve or export it before promotion.`);
      }
      return { ready: !blockers.length, blockers, recordCount: pendingSignups };
    },
    exportSnapshot: async () => ({ version: 1 }),
    restoreSnapshot: async (_client, _departmentId, input) => {
      if (!input || typeof input !== "object" || (input as { version?: unknown }).version !== 1) throw new Error("The Email Delivery snapshot is invalid.");
      return { recordCount: 0 };
    },
    verifySnapshot: async () => ({ ready: true, blockers: [] }),
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
