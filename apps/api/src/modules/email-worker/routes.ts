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
