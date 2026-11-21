import { isIP } from "node:net";
import type { FastifyInstance } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";
import { amxAudioActions, amxAudioLevels, amxAudioPages, amxSystemActions } from "./audio-mappings.js";
import { decryptTelnetPassword, encryptTelnetPassword } from "./credentials.js";
import { pulseChannel, readDeviceLevels } from "./telnet.js";

type AmxAction = { id: string; name: string; command: string };
type AmxSettings = { host: string; port: number; username: string; password: string; clearPassword: boolean; actions: AmxAction[] };
const roomActions: AmxAction[] = [
  { id: "hall-crosswise", name: "Gemeindesaal quer", command: "PULSE[10001:1:1,11]" },
  { id: "hall-lengthwise", name: "Gemeindesaal längs", command: "PULSE[10001:1:1,16]" },
  { id: "conference-1", name: "Konferenzsaal 1", command: "PULSE[10001:1:1,13]" },
  { id: "library", name: "Bibliothek", command: "PULSE[10001:1:1,12]" },
  { id: "all-autonomous", name: "Alle Räume Autonom", command: "PULSE[10001:1:1,15]" },
  { id: "conference-large", name: "Konferenz gross", command: "PULSE[10001:1:1,14]" },
];
const audioActions: AmxAction[] = amxAudioActions.map((item) => ({
  id: item.id,
  name: item.name,
  command: `PULSE[10001:${item.port ?? 2}:1,${item.channel}]`,
}));
const defaultSettings: AmxSettings = { host: "", port: 23, username: "", password: "", clearPassword: false, actions: roomActions };

function validHost(host: string) {
  if (!host || host.length > 253 || host.includes("://") || /[\s/@\\]/.test(host)) return false;
  if (isIP(host)) return true;
  return /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*\.?$/.test(host);
}

function cleanSettings(input: AmxSettings): AmxSettings | null {
  const host = input.host.trim();
  const username = input.username.trim();
  if (!validHost(host) || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535
    || username.length > 64 || typeof input.password !== "string" || input.password.length > 256
    || typeof input.clearPassword !== "boolean" || (input.password && !username)
    || !Array.isArray(input.actions) || input.actions.length !== roomActions.length) return null;
  const ids = new Set<string>();
  const actions: AmxAction[] = [];
  for (const action of input.actions) {
    const preset = roomActions.find((item) => item.id === action?.id);
    if (!action || !preset || ids.has(action.id) || action.name !== preset.name
      || action.command !== preset.command) return null;
    ids.add(action.id);
    actions.push({ id: action.id, name: preset.name, command: action.command });
  }
  if (roomActions.some((preset) => !ids.has(preset.id))) return null;
  return { host, port: input.port, username, password: input.password, clearPassword: input.clearPassword, actions: roomActions.map((preset) => actions.find((item) => item.id === preset.id)!) };
}

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation } = context;

  async function requireAmxDepartment(request: Parameters<typeof resolveDepartmentId>[0], reply: Parameters<typeof resolveDepartmentId>[1], requireSiteAdmin = false) {
    if (!context.activation.isEnabled()) {
      reply.code(404).send({ error: "AMX Control is not enabled for this installation." });
      return null;
    }
    if (!pool || !isDatabaseReady()) {
      reply.code(503).send({ error: "The account database is unavailable." });
      return null;
    }
    const departmentId = await resolveDepartmentId(request, reply, requireSiteAdmin);
    if (!departmentId) return null;
    const enabled = await pool.query<{ enabled_modules: string[] }>("SELECT enabled_modules FROM departments WHERE id=$1", [departmentId]);
    if (!(enabled.rows[0]?.enabled_modules ?? []).includes("amx")) {
      reply.code(404).send({ error: "AMX Control is not enabled for this location." });
      return null;
    }
    if (!requireSiteAdmin) {
      const membership = await pool.query<{ role: string; module_permissions: Record<string, string[]> | null }>(
        "SELECT role,module_permissions FROM department_memberships WHERE department_id=$1 AND user_id=$2",
        [departmentId, request.authenticatedUser?.id],
      );
      const access = membership.rows[0];
      if (access?.role !== "site_admin" && !(access?.module_permissions?.amx ?? []).includes("control")) {
        reply.code(403).send({ error: "AMX control access has not been granted for this location." });
        return null;
      }
    }
    return departmentId;
  }

  app.get("/api/modules/amx/status", async (request, reply) => {
    const departmentId = await requireAmxDepartment(request, reply);
    if (!departmentId) return reply;
    const result = await pool!.query<{ host: string }>("SELECT host FROM amx_site_settings WHERE department_id=$1", [departmentId]);
    return { configured: Boolean(result.rows[0]?.host) };
  });

  app.get<{ Querystring: { page?: string } }>("/api/modules/amx/levels", async (request, reply) => {
    const departmentId = await requireAmxDepartment(request, reply);
    if (!departmentId) return reply;
    const page = amxAudioPages.find((item) => item.id === request.query.page);
    if (!page) return reply.code(400).send({ error: "Choose a known AMX audio page to read its levels." });
    const result = await pool!.query<{ host: string; port: number; username: string; password_ciphertext: string }>("SELECT host,port,username,password_ciphertext FROM amx_site_settings WHERE department_id=$1", [departmentId]);
    const storedSettings = result.rows[0];
    const settings = storedSettings ? { ...storedSettings, port: storedSettings.port === 1319 ? 23 : storedSettings.port } : defaultSettings;
    if (!settings.host) return reply.code(409).send({ error: "Enter the NetLinx controller IP address or hostname under AMX module settings first." });
    const pageLevels = amxAudioLevels.filter((item) => item.page === page.id);
    const ports = [...new Set(pageLevels.map((item) => item.port))];
    if (!pageLevels.length || !ports.length) return { page: page.id, values: {} };
    try {
      const values: Record<string, number> = {};
      for (const port of ports) {
        const requested = [...new Set(pageLevels.filter((item) => item.port === port).map((item) => item.level))];
        const passwordCiphertext = storedSettings?.password_ciphertext ?? "";
        const levels = await readDeviceLevels({ host: settings.host, port: settings.port, username: settings.username ?? "", password: passwordCiphertext ? decryptTelnetPassword(passwordCiphertext) : "" }, { device: 10001, port, system: 1 }, requested);
        Object.assign(values, levels);
      }
      return { page: page.id, values, updatedAt: new Date().toISOString() };
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : "Could not read AMX level feedback." });
    }
  });

  app.get("/api/modules/amx/settings", async (request, reply) => {
    const departmentId = await requireAmxDepartment(request, reply, true);
    if (!departmentId) return reply;
    const result = await pool!.query("SELECT host,port,username,password_ciphertext FROM amx_site_settings WHERE department_id=$1", [departmentId]);
    const row = result.rows[0] as { host: string; port: number; username: string; password_ciphertext: string } | undefined;
    if (!row) return defaultSettings;
    // Earlier builds stored the ICSP default. Port 23 is the NetLinx Telnet terminal.
    return { host: row.host, port: row.port === 1319 ? 23 : row.port, username: row.username ?? "", password: "", clearPassword: false, passwordConfigured: Boolean(row.password_ciphertext), actions: roomActions };
  });

  app.put<{ Body: AmxSettings }>("/api/modules/amx/settings", {
    schema: { body: { type: "object", additionalProperties: false, required: ["host", "port", "username", "password", "clearPassword", "actions"], properties: {
      host: { type: "string", minLength: 1, maxLength: 253 }, port: { type: "integer", minimum: 1, maximum: 65535 },
      username: { type: "string", maxLength: 64 }, password: { type: "string", maxLength: 256 }, clearPassword: { type: "boolean" },
      actions: { type: "array", minItems: 6, maxItems: 6, items: { type: "object", additionalProperties: false, required: ["id", "name", "command"], properties: {
        id: { type: "string", minLength: 1, maxLength: 64 }, name: { type: "string", minLength: 1, maxLength: 80 }, command: { type: "string", maxLength: 512 },
      } } },
    } } },
  }, async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await requireAmxDepartment(request, reply, true);
    if (!departmentId) return reply;
    const settings = cleanSettings(request.body);
    if (!settings) return reply.code(400).send({ error: "Enter a valid controller host, Telnet port, and existing NetLinx login (if required)." });
    const existing = await pool!.query<{ password_ciphertext: string }>("SELECT password_ciphertext FROM amx_site_settings WHERE department_id=$1", [departmentId]);
    const currentPassword = existing.rows[0]?.password_ciphertext ?? "";
    const passwordCiphertext = settings.clearPassword ? "" : settings.password ? encryptTelnetPassword(settings.password) : currentPassword;
    await pool!.query(`INSERT INTO amx_site_settings(department_id,host,port,username,password_ciphertext,actions) VALUES($1,$2,$3,$4,$5,$6::jsonb)
      ON CONFLICT(department_id) DO UPDATE SET host=EXCLUDED.host,port=EXCLUDED.port,username=EXCLUDED.username,password_ciphertext=EXCLUDED.password_ciphertext,actions=EXCLUDED.actions,updated_at=now()`,
    [departmentId, settings.host, settings.port, settings.username, passwordCiphertext, JSON.stringify(settings.actions)]);
    return { host: settings.host, port: settings.port, username: settings.username, password: "", clearPassword: false, passwordConfigured: Boolean(passwordCiphertext), actions: roomActions };
  });

  app.post<{ Body: { actionId: string } }>("/api/modules/amx/send", {
    schema: { body: { type: "object", additionalProperties: false, required: ["actionId"], properties: { actionId: { type: "string", minLength: 1, maxLength: 64 } } } },
  }, async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await requireAmxDepartment(request, reply);
    if (!departmentId) return reply;
    const result = await pool!.query<{ host: string; port: number; username: string; password_ciphertext: string }>("SELECT host,port,username,password_ciphertext FROM amx_site_settings WHERE department_id=$1", [departmentId]);
    const storedSettings = result.rows[0];
    const settings = storedSettings ? { ...storedSettings, port: storedSettings.port === 1319 ? 23 : storedSettings.port } : defaultSettings;
    if (!settings.host) return reply.code(409).send({ error: "Enter the NetLinx controller IP address or hostname under AMX module settings first." });
    const passwordCiphertext = storedSettings?.password_ciphertext ?? "";
    const systemActions: AmxAction[] = amxSystemActions.map((item) => ({ id: item.id, name: item.name, command: `PULSE[10001:${item.port ?? 1}:1,${item.channel}]` }));
    const action = [...roomActions, ...systemActions, ...audioActions].find((item) => item.id === request.body.actionId);
    if (!action) return reply.code(403).send({ error: "This AMX room action is not supported." });
    try {
      const match = action.command.match(/^PULSE\[10001:(\d+):1,(\d+)\]$/);
      const port = Number(match?.[1]);
      const channel = Number(match?.[2]);
      if (!Number.isInteger(port) || !Number.isInteger(channel)) return reply.code(409).send({ error: "The confirmed AMX mapping is invalid." });
      await pulseChannel({ host: settings.host, port: settings.port, username: settings.username ?? "", password: passwordCiphertext ? decryptTelnetPassword(passwordCiphertext) : "" }, { device: 10001, port, system: 1 }, channel);
      return { sent: true, actionId: action.id };
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : "Could not send the AMX command." });
    }
  });
}
