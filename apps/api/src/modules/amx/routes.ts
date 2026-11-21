import { isIP } from "node:net";
import type { FastifyInstance } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";
import { amxAudioActions, amxAudioLevels, amxAudioPages, amxSystemActions } from "./audio-mappings.js";
import { readIcspDeviceChannels, readIcspDeviceLevels, pulseIcspChannel } from "./icsp.js";

type AmxAction = { id: string; name: string; command: string };
type AmxSettings = { host: string; actions: AmxAction[] };
// Keep Smart-Church input events separate from the physical touch panel.
const CONTROL_DEVICE = 34001;
const roomActions: AmxAction[] = [
  { id: "hall-crosswise", name: "Gemeindesaal quer", command: `ICSP[${CONTROL_DEVICE}:1:1,11]` },
  { id: "hall-lengthwise", name: "Gemeindesaal längs", command: `ICSP[${CONTROL_DEVICE}:1:1,16]` },
  { id: "conference-1", name: "Konferenzsaal 1", command: `ICSP[${CONTROL_DEVICE}:1:1,13]` },
  { id: "library", name: "Bibliothek", command: `ICSP[${CONTROL_DEVICE}:1:1,12]` },
  { id: "all-autonomous", name: "Alle Räume Autonom", command: `ICSP[${CONTROL_DEVICE}:1:1,15]` },
  { id: "conference-large", name: "Konferenz gross", command: `ICSP[${CONTROL_DEVICE}:1:1,14]` },
];
const audioActions: AmxAction[] = amxAudioActions.map((item) => ({
  id: item.id,
  name: item.name,
  command: `ICSP[${CONTROL_DEVICE}:${item.port ?? 2}:1,${item.channel}]`,
}));
const defaultSettings: AmxSettings = { host: "", actions: roomActions };
const roomStatusChannels: Array<[number, string]> = [
  [11, "Gemeindesaal quer"], [16, "Gemeindesaal längs"], [13, "Konferenzsaal 1"],
  [12, "Bibliothek"], [15, "Alle Räume Autonom"], [14, "Konferenz gross"],
];

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
    if (request.query.page === "PWR_COUNT") {
      const result = await pool!.query<{ host: string }>("SELECT host FROM amx_site_settings WHERE department_id=$1", [departmentId]);
      const host = result.rows[0]?.host;
      if (!host) return reply.code(409).send({ error: "Enter the NetLinx controller IP address or hostname under AMX module settings first." });
      try {
        const values = await readIcspDeviceLevels(host, { device: 10001, port: 1, system: 1 }, [1]);
        return { page: "PWR_COUNT", values, updatedAt: new Date().toISOString() };
      } catch (error) {
        return reply.code(502).send({ error: error instanceof Error ? error.message : "Could not read AMX activation progress." });
      }
    }
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

  app.get("/api/modules/amx/controller-state", async (request, reply) => {
    const departmentId = await requireAmxDepartment(request, reply);
    if (!departmentId) return reply;
    const result = await pool!.query<{ host: string }>("SELECT host FROM amx_site_settings WHERE department_id=$1", [departmentId]);
    const host = result.rows[0]?.host;
    if (!host) return reply.code(409).send({ error: "Enter the NetLinx controller IP address or hostname under AMX module settings first." });
    try {
      // The TP4's four DSP status indicators are on channels 21–24 across
      // panel ports 1–4. Read every mapped port so indicators 3 and 4 are
      // backed by live state too.
      const channelsByPort: Record<string, number[]> = Object.fromEntries(await Promise.all(
        [1, 2, 3, 4].map(async (port) => [
          String(port),
          await readIcspDeviceChannels(host, { device: 10001, port, system: 1 }),
        ] as const),
      ));
      const portOneChannels = channelsByPort["1"] ?? [];
      const activeRooms = roomStatusChannels.filter(([channel]) => portOneChannels.includes(channel)).map(([, name]) => name);
      return {
        currentRoom: activeRooms.length === 1 ? activeRooms[0] : null,
        activeRooms,
        channels: portOneChannels,
        channelsByPort,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : "Could not read current AMX mode." });
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
    const systemActions: AmxAction[] = amxSystemActions.map((item) => ({ id: item.id, name: item.name, command: `ICSP[${CONTROL_DEVICE}:${item.port ?? 1}:1,${item.channel}]` }));
    const action = [...roomActions, ...systemActions, ...audioActions].find((item) => item.id === request.body.actionId);
    if (!action) return reply.code(403).send({ error: "This AMX room action is not supported." });
    try {
      const match = action.command.match(new RegExp(`^ICSP\\[${CONTROL_DEVICE}:(\\d+):1,(\\d+)\\]$`));
      const port = Number(match?.[1]);
      const channel = Number(match?.[2]);
      if (!Number.isInteger(port) || !Number.isInteger(channel)) return reply.code(409).send({ error: "The confirmed ICSP mapping is invalid." });
      await pulseIcspChannel(settings.host, { device: CONTROL_DEVICE, port, system: 1 }, channel);
      return { sent: true, actionId: action.id };
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : "Could not send the AMX command." });
    }
  });
}

