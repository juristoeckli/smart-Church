import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { FastifyInstance } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";
import { amxAudioActions, amxAudioLevels, amxAudioPages, amxSystemActions } from "./audio-mappings.js";
import { decryptTelnetPassword, encryptTelnetPassword } from "./credentials.js";
import { openNetLinxWebControlSession, type NetLinxWebControlSession } from "./webcontrol.js";
import { readTelnetDeviceChannels, readTelnetDeviceStatus, type TelnetSettings } from "./telnet.js";

type AmxAction = { id: string; name: string; command: string };
type AmxSettings = { host: string; port: number; username: string; password: string; clearPassword: boolean; webConsoleUsername: string; webConsolePassword: string; clearWebConsolePassword: boolean; actions: AmxAction[] };
// The running EBV program exposes and combines virtual device 33001 with the
// existing touchpanels. Device 34001 is not present on this controller.
const CONTROL_DEVICE = 33001;
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
const defaultSettings: AmxSettings = { host: "", port: 23, username: "", password: "", clearPassword: false, webConsoleUsername: "", webConsolePassword: "", clearWebConsolePassword: false, actions: roomActions };
const roomStatusChannels: Array<[number, string]> = [
  [11, "Gemeindesaal quer"], [16, "Gemeindesaal längs"], [13, "Konferenzsaal 1"],
  [12, "Bibliothek"], [15, "Alle Räume Autonom"], [14, "Konferenz gross"],
];
// TP4 channel feedback is mapped to these panel ports; objects without an
// explicit channelPort use port 1.
const panelFeedbackPorts = [1, 2, 3, 9, 10, 13] as const;

function validHost(host: string) {
  if (!host || host.length > 253 || host.includes("://") || /[\s/@\\]/.test(host)) return false;
  if (isIP(host)) return true;
  return /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*\.?$/.test(host);
}

function cleanSettings(input: AmxSettings): AmxSettings | null {
  const host = input.host.trim();
  const username = typeof input.username === "string" ? input.username.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const webConsoleUsername = typeof input.webConsoleUsername === "string" ? input.webConsoleUsername.trim() : "";
  const webConsolePassword = typeof input.webConsolePassword === "string" ? input.webConsolePassword : "";
  if (!validHost(host) || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535
    || username.length > 64 || password.length > 256 || typeof input.clearPassword !== "boolean"
    || (password && !username) || webConsoleUsername.length > 64 || webConsolePassword.length > 256
    || typeof input.clearWebConsolePassword !== "boolean" || (webConsolePassword && !webConsoleUsername)
    || !Array.isArray(input.actions) || input.actions.length !== roomActions.length) return null;
  const ids = new Set<string>();
  const actions: AmxAction[] = [];
  for (const action of input.actions) {
    const preset = roomActions.find((item) => item.id === action?.id);
    if (!action || !preset || ids.has(action.id) || action.name !== preset.name || action.command !== preset.command) return null;
    ids.add(action.id);
    actions.push({ id: action.id, name: preset.name, command: action.command });
  }
  if (roomActions.some((preset) => !ids.has(preset.id))) return null;
  return { host, port: input.port, username, password, clearPassword: input.clearPassword, webConsoleUsername, webConsolePassword, clearWebConsolePassword: input.clearWebConsolePassword, actions: roomActions.map((preset) => actions.find((item) => item.id === preset.id)!) };
}

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation } = context;
  const heldChannels = new Map<string, { session: NetLinxWebControlSession; departmentId: string; userId: string; address: { device: number; port: number; system: number }; channel: number; timer: NodeJS.Timeout }>();

  async function getTelnetSettings(departmentId: string): Promise<(TelnetSettings & { webConsoleUsername: string; webConsolePassword: string }) | null> {
    const result = await pool!.query<{ host: string; port: number; username: string; password_ciphertext: string; webconsole_username: string; webconsole_password_ciphertext: string }>(
      "SELECT host,port,username,password_ciphertext,webconsole_username,webconsole_password_ciphertext FROM amx_site_settings WHERE department_id=$1", [departmentId]);
    const row = result.rows[0];
    if (!row?.host) return null;
    return { host: row.host, port: row.port === 1319 ? 23 : row.port || 23, username: row.username ?? "", password: row.password_ciphertext ? decryptTelnetPassword(row.password_ciphertext) : "", webConsoleUsername: row.webconsole_username ?? "", webConsolePassword: row.webconsole_password_ciphertext ? decryptTelnetPassword(row.webconsole_password_ciphertext) : "" };
  }

  function releaseHeldChannel(pressId: string) {
    const held = heldChannels.get(pressId);
    if (!held) return Promise.resolve(false);
    heldChannels.delete(pressId);
    clearTimeout(held.timer);
    return held.session.emulateButton(held.address, held.channel, "channelRelease")
      .finally(() => held.session.close());
  }

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
    const settings = await getTelnetSettings(departmentId);
    if (!settings?.host) return reply.code(409).send({ error: "Enter the NetLinx controller address under AMX module settings first." });
    if (request.query.page === "PWR_COUNT") {
      try {
        const status = await readTelnetDeviceStatus(settings, { device: 10001, port: 1, system: 1 });
        if (status.levels[1] === undefined) throw new Error("NetLinx Telnet status did not include activation progress level 1.");
        return { page: "PWR_COUNT", values: { 1: status.levels[1] }, updatedAt: new Date().toISOString() };
      } catch (error) {
        return reply.code(502).send({ error: error instanceof Error ? error.message : "Could not read AMX activation progress." });
      }
    }
    const page = amxAudioPages.find((item) => item.id === request.query.page);
    if (!page) return reply.code(400).send({ error: "Choose a known AMX audio page to read its levels." });
    const pageLevels = amxAudioLevels.filter((item) => item.page === page.id);
    const ports = [...new Set(pageLevels.map((item) => item.port))];
    if (!pageLevels.length || !ports.length) return { page: page.id, values: {} };
    try {
      const values: Record<string, number> = {};
      for (const port of ports) {
        const requested = [...new Set(pageLevels.filter((item) => item.port === port).map((item) => item.level))];
        const status = await readTelnetDeviceStatus(settings, { device: 10001, port, system: 1 });
        for (const level of requested) {
          const value = status.levels[level];
          if (value === undefined) throw new Error(`NetLinx Telnet status did not include level ${level} on port ${port}.`);
          values[level] = value;
        }
      }
      return { page: page.id, values, updatedAt: new Date().toISOString() };
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : "Could not read AMX level feedback." });
    }
  });

  app.get("/api/modules/amx/controller-state", async (request, reply) => {
    const departmentId = await requireAmxDepartment(request, reply);
    if (!departmentId) return reply;
    const settings = await getTelnetSettings(departmentId);
    if (!settings) return reply.code(409).send({ error: "Enter the NetLinx controller IP address or hostname under AMX module settings first." });
    try {
      const channelsByPort: Record<string, number[]> = {};
      for (const port of panelFeedbackPorts) channelsByPort[String(port)] = await readTelnetDeviceChannels(settings, { device: 10001, port, system: 1 });
      const portOneChannels = channelsByPort["1"] ?? [];
      const activeRooms = roomStatusChannels.filter(([channel]) => portOneChannels.includes(channel)).map(([, name]) => name);
      return { currentRoom: activeRooms.length === 1 ? activeRooms[0] : null, activeRooms, channels: portOneChannels, channelsByPort, updatedAt: new Date().toISOString() };
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : "Could not read current AMX mode." });
    }
  });

  app.get("/api/modules/amx/settings", async (request, reply) => {
    const departmentId = await requireAmxDepartment(request, reply, true);
    if (!departmentId) return reply;
    const result = await pool!.query<{ host: string; port: number; username: string; password_ciphertext: string; webconsole_username: string; webconsole_password_ciphertext: string }>(
      "SELECT host,port,username,password_ciphertext,webconsole_username,webconsole_password_ciphertext FROM amx_site_settings WHERE department_id=$1", [departmentId]);
    const row = result.rows[0];
    return row ? { host: row.host, port: row.port === 1319 ? 23 : row.port || 23, username: row.username ?? "", password: "", clearPassword: false, passwordConfigured: Boolean(row.password_ciphertext), webConsoleUsername: row.webconsole_username ?? "", webConsolePassword: "", clearWebConsolePassword: false, webConsolePasswordConfigured: Boolean(row.webconsole_password_ciphertext), actions: roomActions } : defaultSettings;
  });

  app.put<{ Body: AmxSettings }>("/api/modules/amx/settings", {
    schema: { body: { type: "object", additionalProperties: false, required: ["host", "port", "username", "password", "clearPassword", "webConsoleUsername", "webConsolePassword", "clearWebConsolePassword", "actions"], properties: {
      host: { type: "string", minLength: 1, maxLength: 253 }, port: { type: "integer", minimum: 1, maximum: 65535 },
      username: { type: "string", maxLength: 64 }, password: { type: "string", maxLength: 256 }, clearPassword: { type: "boolean" },
      webConsoleUsername: { type: "string", maxLength: 64 }, webConsolePassword: { type: "string", maxLength: 256 }, clearWebConsolePassword: { type: "boolean" },
      actions: { type: "array", minItems: 6, maxItems: 6, items: { type: "object", additionalProperties: false, required: ["id", "name", "command"], properties: {
        id: { type: "string", minLength: 1, maxLength: 64 }, name: { type: "string", minLength: 1, maxLength: 80 }, command: { type: "string", maxLength: 512 },
      } } },
    } } },
  }, async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await requireAmxDepartment(request, reply, true);
    if (!departmentId) return reply;
    const settings = cleanSettings(request.body);
    if (!settings) return reply.code(400).send({ error: "Enter a valid NetLinx host, Telnet port, and existing login if required." });
    const existing = await pool!.query<{ password_ciphertext: string; webconsole_password_ciphertext: string }>("SELECT password_ciphertext,webconsole_password_ciphertext FROM amx_site_settings WHERE department_id=$1", [departmentId]);
    const currentTelnetCiphertext = existing.rows[0]?.password_ciphertext ?? "";
    const currentWebConsoleCiphertext = existing.rows[0]?.webconsole_password_ciphertext ?? "";
    const passwordCiphertext = settings.clearPassword ? "" : settings.password ? encryptTelnetPassword(settings.password) : currentTelnetCiphertext;
    const webConsolePasswordCiphertext = settings.clearWebConsolePassword ? "" : settings.webConsolePassword ? encryptTelnetPassword(settings.webConsolePassword) : currentWebConsoleCiphertext;
    await pool!.query(`INSERT INTO amx_site_settings(department_id,host,port,username,password_ciphertext,webconsole_username,webconsole_password_ciphertext,actions) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
      ON CONFLICT(department_id) DO UPDATE SET host=EXCLUDED.host,port=EXCLUDED.port,username=EXCLUDED.username,password_ciphertext=EXCLUDED.password_ciphertext,webconsole_username=EXCLUDED.webconsole_username,webconsole_password_ciphertext=EXCLUDED.webconsole_password_ciphertext,actions=EXCLUDED.actions,updated_at=now()`,
    [departmentId, settings.host, settings.port, settings.username, passwordCiphertext, settings.webConsoleUsername, webConsolePasswordCiphertext, JSON.stringify(settings.actions)]);
    return { ...settings, password: "", clearPassword: false, passwordConfigured: Boolean(passwordCiphertext), webConsolePassword: "", clearWebConsolePassword: false, webConsolePasswordConfigured: Boolean(webConsolePasswordCiphertext) };
  });

  app.post<{ Body: { actionId: string } }>("/api/modules/amx/press", {
    schema: { body: { type: "object", additionalProperties: false, required: ["actionId"], properties: { actionId: { type: "string", minLength: 1, maxLength: 64 } } } },
  }, async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await requireAmxDepartment(request, reply);
    if (!departmentId) return reply;
    const userId = request.authenticatedUser?.id;
    if (!userId) return reply.code(401).send({ error: "Sign in to control AMX." });
    const settings = await getTelnetSettings(departmentId);
    if (!settings) return reply.code(409).send({ error: "Enter the NetLinx controller address under AMX module settings first." });
    const controls: AmxAction[] = [
      ...roomActions,
      ...amxSystemActions.map((item) => ({ id: item.id, name: item.name, command: `ICSP[${CONTROL_DEVICE}:1:1,${item.channel}]` })),
      ...audioActions,
    ];
    const action = controls.find((item) => item.id === request.body.actionId);
    const match = action?.command.match(new RegExp(`^ICSP\\[${CONTROL_DEVICE}:(\\d+):1,(\\d+)\\]$`));
    if (!match || !action) return reply.code(403).send({ error: "This AMX held control is not mapped." });
    const address = { device: CONTROL_DEVICE, port: Number(match[1]), system: 1 };
    const channel = Number(match[2]);
    let session: NetLinxWebControlSession | undefined;
    try {
      session = await openNetLinxWebControlSession({ host: settings.host, username: settings.webConsoleUsername, password: settings.webConsolePassword });
      await session.emulateButton(address, channel, "channelPush");
      const pressId = randomUUID();
      const timer = setTimeout(() => { void releaseHeldChannel(pressId).catch(() => undefined); }, 30000);
      heldChannels.set(pressId, { session, departmentId, userId, address, channel, timer });
      return { pressId, actionId: action.id };
    } catch (error) {
      session?.close();
      return reply.code(502).send({ error: error instanceof Error ? error.message : "Could not hold the AMX channel." });
    }
  });

  app.post<{ Body: { pressId: string } }>("/api/modules/amx/release", {
    schema: { body: { type: "object", additionalProperties: false, required: ["pressId"], properties: { pressId: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await requireAmxDepartment(request, reply);
    if (!departmentId) return reply;
    const held = heldChannels.get(request.body.pressId);
    if (!held || held.departmentId !== departmentId || held.userId !== request.authenticatedUser?.id) return reply.code(404).send({ error: "This AMX button press is no longer active." });
    try {
      await releaseHeldChannel(request.body.pressId);
      return { released: true };
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : "Could not release the AMX channel." });
    }
  });

  app.post<{ Body: { actionId: string } }>("/api/modules/amx/send", {
    schema: { body: { type: "object", additionalProperties: false, required: ["actionId"], properties: { actionId: { type: "string", minLength: 1, maxLength: 64 } } } },
  }, async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const departmentId = await requireAmxDepartment(request, reply);
    if (!departmentId) return reply;
    const settings = await getTelnetSettings(departmentId);
    if (!settings) return reply.code(409).send({ error: "Enter the NetLinx controller IP address or hostname under AMX module settings first." });
    const systemActions: AmxAction[] = amxSystemActions.map((item) => ({ id: item.id, name: item.name, command: `ICSP[${CONTROL_DEVICE}:${item.port ?? 1}:1,${item.channel}]` }));
    const action = [...roomActions, ...systemActions, ...audioActions].find((item) => item.id === request.body.actionId);
    if (!action) return reply.code(403).send({ error: "This AMX room action is not supported." });
    try {
      const match = action.command.match(new RegExp(`^ICSP\\[${CONTROL_DEVICE}:(\\d+):1,(\\d+)\\]$`));
      const port = Number(match?.[1]);
      const channel = Number(match?.[2]);
      if (!Number.isInteger(port) || !Number.isInteger(channel)) return reply.code(409).send({ error: "The confirmed Telnet mapping is invalid." });
      const address = { device: CONTROL_DEVICE, port, system: 1 };
      const session = await openNetLinxWebControlSession({ host: settings.host, username: settings.webConsoleUsername, password: settings.webConsolePassword });
      try {
        await session.emulateButton(address, channel, "channelPush");
        await new Promise((resolve) => setTimeout(resolve, 120));
        await session.emulateButton(address, channel, "channelRelease");
      } finally { session.close(); }
      return { sent: true, actionId: action.id };
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : "Could not send the AMX command." });
    }
  });
}


