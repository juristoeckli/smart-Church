import { isIP } from "node:net";
import { Socket } from "node:net";
import type { FastifyInstance } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";

type AmxAction = { id: string; name: string; command: string };
type AmxSettings = { host: string; port: number; actions: AmxAction[] };
const roomActions: AmxAction[] = [
  { id: "hall-crosswise", name: "Gemeindesaal quer", command: "" },
  { id: "hall-lengthwise", name: "Gemeindesaal längs", command: "" },
  { id: "conference-1", name: "Konferenzsaal 1", command: "" },
  { id: "library", name: "Bibliothek", command: "" },
  { id: "all-autonomous", name: "Alle Räume Autonom", command: "" },
  { id: "conference-large", name: "Konferenz gross", command: "" },
];
const defaultSettings: AmxSettings = { host: "10.2.14.10", port: 23, actions: roomActions };

function validHost(host: string) {
  if (!host || host.length > 253 || host.includes("://") || /[\s/@\\]/.test(host)) return false;
  if (isIP(host)) return true;
  return /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*\.?$/.test(host);
}

function cleanSettings(input: AmxSettings): AmxSettings | null {
  const host = input.host.trim();
  if (!validHost(host) || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535 || !Array.isArray(input.actions) || input.actions.length !== roomActions.length) return null;
  const ids = new Set<string>();
  const actions: AmxAction[] = [];
  for (const action of input.actions) {
    const preset = roomActions.find((item) => item.id === action?.id);
    if (!action || !preset || ids.has(action.id)
      || action.name !== preset.name
      || typeof action.command !== "string" || action.command.length > 512
      || /[\r\n\u0000]/.test(action.command)) return null;
    ids.add(action.id);
    actions.push({ id: action.id, name: preset.name, command: action.command.trim() });
  }
  return { host, port: input.port, actions: roomActions.map((preset) => actions.find((item) => item.id === preset.id)!) };
}

function sendCommand(host: string, port: number, command: string) {
  return new Promise<void>((resolve, reject) => {
    const socket = new Socket();
    let settled = false;
    let sent = false;
    let received = "";
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve();
    };
    socket.setTimeout(5000, () => finish(new Error("The AMX controller did not return a Telnet prompt.")));
    socket.on("data", (chunk) => {
      received = `${received}${chunk.toString("utf8")}`.slice(-4096);
      if (!sent && />\s*$/.test(received)) {
        sent = true;
        received = "";
        socket.write(`${command}\r\n`);
      } else if (sent && />\s*$/.test(received)) {
        if (/unknown command|invalid command|not authorized|authentication failed/i.test(received)) finish(new Error("The AMX controller rejected the command."));
        else finish();
      }
    });
    socket.once("error", (error) => finish(new Error(`Could not reach the AMX controller: ${error.message}`)));
    socket.once("close", () => { if (!settled) finish(new Error("The AMX controller closed the Telnet connection.")); });
    socket.connect(port, host);
  });
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
    return row ? { host: row.host, port: row.port, actions: row.actions } : defaultSettings;
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
    if (!settings) return reply.code(400).send({ error: "Enter a valid controller host, port, and up to 40 actions. Commands must be a single line." });
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
    const settings = result.rows[0];
    const action = settings?.actions.find((item) => item.id === request.body.actionId);
    if (!settings || !action) return reply.code(404).send({ error: "The AMX room action was not found." });
    if (!action.command) return reply.code(409).send({ error: "Add the NetLinx command for this room under AMX module settings first." });
    try {
      await sendCommand(settings.host, settings.port, action.command);
      return { sent: true, actionId: action.id };
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : "Could not send the AMX command." });
    }
  });
}
