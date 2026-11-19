import { isIP } from "node:net";
import type { FastifyInstance } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";
import { pulseChannel } from "./icsp.js";

type AmxAction = { id: string; name: string; command: string };
type AmxSettings = { host: string; port: number; actions: AmxAction[] };
const roomActions: AmxAction[] = [
  { id: "hall-crosswise", name: "Gemeindesaal quer", command: "PULSE[10001:1:0,11]" },
  { id: "hall-lengthwise", name: "Gemeindesaal längs", command: "PULSE[10001:1:0,16]" },
  { id: "conference-1", name: "Konferenzsaal 1", command: "PULSE[10001:1:0,13]" },
  { id: "library", name: "Bibliothek", command: "PULSE[10001:1:0,12]" },
  { id: "all-autonomous", name: "Alle Räume Autonom", command: "PULSE[10001:1:0,15]" },
  { id: "conference-large", name: "Konferenz gross", command: "PULSE[10001:1:0,14]" },
];
const defaultSettings: AmxSettings = { host: "", port: 1319, actions: roomActions };

function sanitizeStoredActions(actions: AmxAction[]): AmxAction[] {
  return roomActions.map((preset) => {
    const stored = actions.find((action) => action && action.id === preset.id);
    return stored && stored.command === preset.command ? preset : { ...preset, command: "" };
  });
}

function validHost(host: string) {
  if (!host || host.length > 253 || host.includes("://") || /[\s/@\\]/.test(host)) return false;
  if (isIP(host)) return true;
  return /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*\.?$/.test(host);
}

function cleanSettings(input: AmxSettings): AmxSettings | null {
  const host = input.host.trim();
  if (!validHost(host) || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535 || input.port === 23
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
  return { host, port: input.port, actions: roomActions.map((preset) => actions.find((item) => item.id === preset.id)!) };
}

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation } = context;

  async function requireAmxAdmin(request: Parameters<typeof resolveDepartmentId>[0], reply: Parameters<typeof resolveDepartmentId>[1]) {
    if (!context.activation.isEnabled()) {
      reply.code(404).send({ error: "AMX Control is not enabled for this installation." });
      return null;
    }
    if (!pool || !isDatabaseReady()) {
      reply.code(503).send({ error: "The account database is unavailable." });
      return null;
    }
    const departmentId = await resolveDepartmentId(request, reply, true);
    if (!departmentId) return null;
    const enabled = await pool.query<{ enabled_modules: string[] }>("SELECT enabled_modules FROM departments WHERE id=$1", [departmentId]);
    if (!(enabled.rows[0]?.enabled_modules ?? []).includes("amx")) {
      reply.code(404).send({ error: "AMX Control is not enabled for this location." });
      return null;
    }
    return departmentId;
  }

  app.get("/api/modules/amx/settings", async (request, reply) => {
    const departmentId = await requireAmxAdmin(request, reply);
    if (!departmentId) return reply;
    const result = await pool!.query("SELECT host,port,actions FROM amx_site_settings WHERE department_id=$1", [departmentId]);
    const row = result.rows[0] as { host: string; port: number; actions: AmxAction[] } | undefined;
    if (!row) return defaultSettings;
    // Normalize old six-room settings while preserving any added page mappings.
    const storedActions = Array.isArray(row.actions) ? row.actions : [];
    return { host: row.host, port: row.port === 23 ? 1319 : row.port, actions: sanitizeStoredActions(storedActions) };
  });

  app.put<{ Body: AmxSettings }>("/api/modules/amx/settings", {
    schema: { body: { type: "object", additionalProperties: false, required: ["host", "port", "actions"], properties: {
      host: { type: "string", minLength: 1, maxLength: 253 }, port: { type: "integer", minimum: 1, maximum: 65535 },
      actions: { type: "array", minItems: 6, maxItems: 6, items: { type: "object", additionalProperties: false, required: ["id", "name", "command"], properties: {
        id: { type: "string", minLength: 1, maxLength: 64 }, name: { type: "string", minLength: 1, maxLength: 80 }, command: { type: "string", maxLength: 512 },
      } } },
    } } },
  }, async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await requireAmxAdmin(request, reply);
    if (!departmentId) return reply;
    const settings = cleanSettings(request.body);
    if (!settings || settings.port === 23) return reply.code(400).send({ error: "Enter a valid controller host, ICSP TCP port, and room mappings using PULSE[device:port:system,channel]." });
    await pool!.query(`INSERT INTO amx_site_settings(department_id,host,port,actions) VALUES($1,$2,$3,$4::jsonb)
      ON CONFLICT(department_id) DO UPDATE SET host=EXCLUDED.host,port=EXCLUDED.port,actions=EXCLUDED.actions,updated_at=now()`,
    [departmentId, settings.host, settings.port, JSON.stringify(settings.actions)]);
    return settings;
  });

  app.post<{ Body: { actionId: string } }>("/api/modules/amx/send", {
    schema: { body: { type: "object", additionalProperties: false, required: ["actionId"], properties: { actionId: { type: "string", minLength: 1, maxLength: 64 } } } },
  }, async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await requireAmxAdmin(request, reply);
    if (!departmentId) return reply;
    const result = await pool!.query<{ host: string; port: number; actions: AmxAction[] }>("SELECT host,port,actions FROM amx_site_settings WHERE department_id=$1", [departmentId]);
    const storedSettings = result.rows[0];
    const settings = storedSettings
      ? { ...storedSettings, actions: sanitizeStoredActions(storedSettings.actions), port: storedSettings.port === 23 ? 1319 : storedSettings.port }
      : defaultSettings;
    if (!settings.host) return reply.code(409).send({ error: "Enter the NetLinx controller IP address or hostname under AMX module settings first." });
    const action = roomActions.find((item) => item.id === request.body.actionId);
    if (!action) return reply.code(403).send({ error: "This AMX room action is not supported." });
    const storedAction = settings.actions.find((item) => item.id === action.id);
    if (!storedAction || storedAction.command !== action.command) return reply.code(409).send({ error: "The confirmed AMX room mapping is missing or invalid." });
    try {
      const channel = Number(action.command.match(/,(\d+)\]$/)?.[1]);
      if (!Number.isInteger(channel)) return reply.code(409).send({ error: "The confirmed AMX room mapping is invalid." });
      await pulseChannel(settings.host, settings.port, { device: 10001, port: 1, system: 0 }, channel);
      return { sent: true, actionId: action.id };
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : "Could not send the AMX command." });
    }
  });
}
