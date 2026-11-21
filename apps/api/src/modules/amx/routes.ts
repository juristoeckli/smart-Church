import { isIP } from "node:net";
import type { FastifyInstance } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";
import { amxAudioActions, amxAudioLevels, amxAudioPages, amxSystemActions } from "./audio-mappings.js";
import { readIcspDeviceLevels, pulseIcspChannel } from "./icsp.js";

type AmxAction = { id: string; name: string; command: string };
type AmxSettings = { host: string; actions: AmxAction[] };
const roomActions: AmxAction[] = [
  { id: "hall-crosswise", name: "Gemeindesaal quer", command: "ICSP[10001:1:1,11]" },
  { id: "hall-lengthwise", name: "Gemeindesaal längs", command: "ICSP[10001:1:1,16]" },
  { id: "conference-1", name: "Konferenzsaal 1", command: "ICSP[10001:1:1,13]" },
  { id: "library", name: "Bibliothek", command: "ICSP[10001:1:1,12]" },
  { id: "all-autonomous", name: "Alle Räume Autonom", command: "ICSP[10001:1:1,15]" },
  { id: "conference-large", name: "Konferenz gross", command: "ICSP[10001:1:1,14]" },
];
const audioActions: AmxAction[] = amxAudioActions.map((item) => ({
  id: item.id,
  name: item.name,
  command: `ICSP[10001:${item.port ?? 2}:1,${item.channel}]`,
}));
const defaultSettings: AmxSettings = { host: "", actions: roomActions };

function validHost(host: string) {
  if (!host || host.length > 253 || host.includes("://") || /[\s/@\\]/.test(host)) return false;
  if (isIP(host)) return true;
  return /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*\.?$/.test(host);
}

function cleanSettings(input: AmxSettings): AmxSettings | null {
  const host = input.host.trim();
  if (!validHost(host) || !Array.isArray(input.actions) || input.actions.length !== roomActions.length) return null;
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
  return { host, actions: roomActions.map((preset) => actions.find((item) => item.id === preset.id)!) };
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
    const result = await pool!.query<{ host: string }>("SELECT host FROM amx_site_settings WHERE department_id=$1", [departmentId]);
    const storedSettings = result.rows[0];
    const settings = storedSettings ?? defaultSettings;
    if (!settings.host) return reply.code(409).send({ error: "Enter the NetLinx controller IP address or hostname under AMX module settings first." });
    const pageLevels = amxAudioLevels.filter((item) => item.page === page.id);
    const ports = [...new Set(pageLevels.map((item) => item.port))];
    if (!pageLevels.length || !ports.length) return { page: page.id, values: {} };
    try {
      const values: Record<string, number> = {};
      for (const port of ports) {
        const requested = [...new Set(pageLevels.filter((item) => item.port === port).map((item) => item.level))];
        const levels = await readIcspDeviceLevels(settings.host, { device: 10001, port, system: 1 }, requested);
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
    const result = await pool!.query("SELECT host FROM amx_site_settings WHERE department_id=$1", [departmentId]);
    const row = result.rows[0] as { host: string } | undefined;
    return row ? { host: row.host, actions: roomActions } : defaultSettings;
  });

  app.put<{ Body: AmxSettings }>("/api/modules/amx/settings", {
    schema: { body: { type: "object", additionalProperties: false, required: ["host", "actions"], properties: {
      host: { type: "string", minLength: 1, maxLength: 253 },
      actions: { type: "array", minItems: 6, maxItems: 6, items: { type: "object", additionalProperties: false, required: ["id", "name", "command"], properties: {
        id: { type: "string", minLength: 1, maxLength: 64 }, name: { type: "string", minLength: 1, maxLength: 80 }, command: { type: "string", maxLength: 512 },
      } } },
    } } },
  }, async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await requireAmxDepartment(request, reply, true);
    if (!departmentId) return reply;
    const settings = cleanSettings(request.body);
    if (!settings) return reply.code(400).send({ error: "Enter a valid NetLinx controller host and ICSP port." });
    await pool!.query(`INSERT INTO amx_site_settings(department_id,host,port,actions) VALUES($1,$2,1319,$3::jsonb)
      ON CONFLICT(department_id) DO UPDATE SET host=EXCLUDED.host,port=EXCLUDED.port,actions=EXCLUDED.actions,updated_at=now()`,
    [departmentId, settings.host, JSON.stringify(settings.actions)]);
    return settings;
  });

  app.post<{ Body: { actionId: string } }>("/api/modules/amx/send", {
    schema: { body: { type: "object", additionalProperties: false, required: ["actionId"], properties: { actionId: { type: "string", minLength: 1, maxLength: 64 } } } },
  }, async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await requireAmxDepartment(request, reply);
    if (!departmentId) return reply;
    const result = await pool!.query<{ host: string }>("SELECT host FROM amx_site_settings WHERE department_id=$1", [departmentId]);
    const storedSettings = result.rows[0];
    const settings = storedSettings ?? defaultSettings;
    if (!settings.host) return reply.code(409).send({ error: "Enter the NetLinx controller IP address or hostname under AMX module settings first." });
    const systemActions: AmxAction[] = amxSystemActions.map((item) => ({ id: item.id, name: item.name, command: `ICSP[10001:${item.port ?? 1}:1,${item.channel}]` }));
    const action = [...roomActions, ...systemActions, ...audioActions].find((item) => item.id === request.body.actionId);
    if (!action) return reply.code(403).send({ error: "This AMX room action is not supported." });
    try {
      const match = action.command.match(/^ICSP\[10001:(\d+):1,(\d+)\]$/);
      const port = Number(match?.[1]);
      const channel = Number(match?.[2]);
      if (!Number.isInteger(port) || !Number.isInteger(channel)) return reply.code(409).send({ error: "The confirmed ICSP mapping is invalid." });
      await pulseIcspChannel(settings.host, { device: 10001, port, system: 1 }, channel);
      return { sent: true, actionId: action.id };
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : "Could not send the AMX command." });
    }
  });
}
