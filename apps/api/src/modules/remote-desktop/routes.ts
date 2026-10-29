import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { ModuleServerContext } from "../module-sdk.js";

type LaptopRole = "controller" | "viewer";
type ProxyRole = LaptopRole | "takeover";
type RemoteProtocol = "rdp" | "vnc" | "spice";
type RemoteDestination = { id: string; departmentId: string; name: string; host: string; port: number; protocol: RemoteProtocol; username: string; password: string; autologin: boolean };
type StoredDestination = Omit<RemoteDestination, "password"> & { password_ciphertext: string; password_iv: string; password_tag: string };
type ProxyTicket = { authToken: string; connectionId: string; expiresAt: number; active: boolean; role: ProxyRole; shareId: string; departmentId: string; destinationId: string; userId: string; socket?: import("node:stream").Duplex };
type ControllerLease = { userId: string; departmentId: string; destinationId: string; ticket: string; shareId: string; width: number; height: number; expiresAt: number; active: boolean };
const proxyTickets = new Map<string, ProxyTicket>();
let controllerLease: ControllerLease | null = null;

function gatewaySettings() {
  const jsonSecret = process.env.SYSTEM_LAPTOP_JSON_SECRET_KEY ?? "";
  const apiUrl = process.env.SYSTEM_LAPTOP_GUACAMOLE_API_URL?.trim().replace(/\/$/, "") ?? "";
  const validUrl = (value: string) => {
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
    } catch { return false; }
  };
  return { configured: /^[\da-f]{32}$/i.test(jsonSecret) && validUrl(apiUrl), jsonSecret, apiUrl };
}

function credentialKey(jsonSecret: string) {
  if (!/^[\da-f]{32}$/i.test(jsonSecret)) throw new Error("The remote desktop encryption key is not configured.");
  return createHash("sha256").update(Buffer.from(jsonSecret, "hex")).digest();
}

function encryptPassword(password: string, jsonSecret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialKey(jsonSecret), iv);
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

function decryptPassword(destination: StoredDestination, jsonSecret: string) {
  const decipher = createDecipheriv("aes-256-gcm", credentialKey(jsonSecret), Buffer.from(destination.password_iv, "base64"));
  decipher.setAuthTag(Buffer.from(destination.password_tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(destination.password_ciphertext, "base64")), decipher.final()]).toString("utf8");
}

function validRemoteHost(host: string) {
  if (!host || host.length > 253 || host.includes("://") || /[\s/\\@]/.test(host)) return false;
  if (isIP(host)) return true;
  return /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*\.?$/.test(host);
}

function defaultPort(protocol: RemoteProtocol) {
  return protocol === "rdp" ? 3389 : protocol === "vnc" ? 5900 : 5900;
}

function rejectUpgrade(socket: import("node:stream").Duplex, status: number, message: string) {
  if (socket.destroyed) return;
  const body = `${message}\n`;
  const reason = status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : status === 404 ? "Not Found" : status === 409 ? "Conflict" : status === 503 ? "Service Unavailable" : "Bad Gateway";
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function encryptedAuthData(settings: ReturnType<typeof gatewaySettings>, destination: RemoteDestination, username: string, shareId: string, role: LaptopRole, joinShared = false) {
  const key = Buffer.from(settings.jsonSecret, "hex");
  const payload = Buffer.from(JSON.stringify({
    username,
    expires: Date.now() + 60_000,
    connections: {
      [destination.name]: role === "viewer" || joinShared ? {
        join: shareId,
        ...(role === "viewer" ? { parameters: { "read-only": "true" } } : {}),
      } : {
        id: shareId,
        protocol: destination.protocol,
        parameters: {
          hostname: destination.host,
          port: String(destination.port),
          ...(destination.autologin ? { username: destination.username, password: destination.password } : {}),
          ...(destination.protocol === "rdp" ? {
          "ignore-cert": "true",
          "disable-audio": "false",
          "enable-drive": "false",
          "enable-printing": "false",
          "resize-method": "display-update",
          } : {}),
        },
      },
    },
  }));
  const signature = createHmac("sha256", key).update(payload).digest();
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16));
  return Buffer.concat([cipher.update(Buffer.concat([signature, payload])), cipher.final()]).toString("base64");
}

export function registerModuleRoutes(app: FastifyInstance, dependencies: ModuleServerContext) {
  const { pool, isDatabaseReady, getDefaultDepartmentId, resolveDepartmentId, validateMutation, realtime } = dependencies;
  let cachedClientLibrary: string | null = null;

  async function requireSystemLaptopAccess(request: FastifyRequest, reply: FastifyReply, allowQueryLocation = false) {
    if (!isDatabaseReady() || !pool) {
      reply.code(503).send({ error: "The account database is unavailable." });
      return null;
    }
    const department = await resolveDepartmentId(request, reply, false, allowQueryLocation);
    if (!department) return null;
    const result = await pool.query(
      `SELECT d.enabled_modules, m.role
         FROM departments d
         JOIN department_memberships m ON m.department_id = d.id
        WHERE d.id = $1 AND m.user_id = $2`,
      [department, request.authenticatedUser?.id],
    );
    const access = result.rows[0];
    if (!access?.enabled_modules?.includes("remote-desktop")) {
      reply.code(404).send({ error: "Remote desktop is not enabled for this location." });
      return null;
    }
    return { department, role: access.role as "site_admin" | "member" };
  }

  function managementDepartment(request: FastifyRequest, reply: FastifyReply) {
    if (request.authenticatedUser?.role !== "server_admin") {
      reply.code(403).send({ error: "Server administrator access is required." });
      return null;
    }
    const value = request.headers["x-department-id"];
    const departmentId = typeof value === "string" ? value : "";
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(departmentId)) {
      reply.code(400).send({ error: "Choose a valid site." });
      return null;
    }
    return departmentId;
  }

  async function listDestinationRows(departmentId: string) {
    if (!pool) return [] as StoredDestination[];
    const gateway = gatewaySettings();
    const siteSettings = await pool.query("SELECT managed FROM remote_desktop_site_settings WHERE department_id = $1", [departmentId]);
    const legacyHost = process.env.SYSTEM_LAPTOP_RDP_HOST?.trim() ?? "";
    if (siteSettings.rows[0]?.managed === false && departmentId === getDefaultDepartmentId() && gateway.configured && validRemoteHost(legacyHost)) {
      const protocol: RemoteProtocol = "rdp";
      const encrypted = encryptPassword(process.env.SYSTEM_LAPTOP_RDP_PASSWORD ?? "", gateway.jsonSecret);
      const id = randomUUID();
      const portText = process.env.SYSTEM_LAPTOP_RDP_PORT?.trim() || String(defaultPort(protocol));
      const port = /^\d{1,5}$/.test(portText) && Number(portText) >= 1 && Number(portText) <= 65535 ? Number(portText) : defaultPort(protocol);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const managed = await client.query("SELECT managed FROM remote_desktop_site_settings WHERE department_id = $1 FOR UPDATE", [departmentId]);
        if (managed.rows[0]?.managed === false) {
          await client.query(
            `INSERT INTO remote_desktop_destinations (id, department_id, name, host, port, protocol, username, password_ciphertext, password_iv, password_tag, autologin)
             VALUES ($1, $2, 'Remote desktop', $3, $4, 'rdp', $5, $6, $7, $8, true)
             ON CONFLICT (department_id, name) DO NOTHING`,
            [id, departmentId, legacyHost, port, process.env.SYSTEM_LAPTOP_RDP_USERNAME ?? "", encrypted.ciphertext, encrypted.iv, encrypted.tag],
          );
          await client.query("UPDATE remote_desktop_site_settings SET managed = true, updated_at = now() WHERE department_id = $1", [departmentId]);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    }
    const result = await pool.query(
      `SELECT id, department_id AS "departmentId", name, host, port, protocol, username, autologin,
              password_ciphertext, password_iv, password_tag
         FROM remote_desktop_destinations WHERE department_id = $1 ORDER BY name, id`,
      [departmentId],
    );
    return result.rows as StoredDestination[];
  }

  function publicDestination(destination: StoredDestination) {
    return { id: destination.id, name: destination.name, host: destination.host, port: destination.port, protocol: destination.protocol, username: destination.username, autologin: destination.autologin, passwordConfigured: Buffer.from(destination.password_ciphertext, "base64").length > 0 };
  }

  async function resolveDestination(departmentId: string, id: string) {
    const gateway = gatewaySettings();
    const rows = await listDestinationRows(departmentId);
    const row = rows.find((destination) => destination.id === id);
    if (!row || !gateway.configured) return null;
    return { settings: gateway, destination: { id: row.id, departmentId: row.departmentId, name: row.name, host: row.host, port: Number(row.port), protocol: row.protocol, username: row.username, password: decryptPassword(row, gateway.jsonSecret), autologin: row.autologin } as RemoteDestination };
  }

  app.get<{ Querystring: { departmentId?: string } }>("/api/modules/remote-desktop/destinations", async (request, reply) => {
    if (!isDatabaseReady() || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
    let departmentId: string;
    if (request.authenticatedUser?.role === "server_admin") {
      const selected = managementDepartment(request, reply);
      if (!selected) return reply;
      departmentId = selected;
    } else {
      const access = await requireSystemLaptopAccess(request, reply);
      if (!access) return reply;
      departmentId = access.department;
    }
    const rows = await listDestinationRows(departmentId);
    return rows.map(publicDestination);
  });

  app.post<{ Body: { name: string; host: string; port: number; protocol: RemoteProtocol; username?: string; password: string; autologin: boolean } }>("/api/modules/remote-desktop/destinations", {
    schema: { body: { type: "object", additionalProperties: false, required: ["name", "host", "port", "protocol", "password", "autologin"], properties: { name: { type: "string", minLength: 1, maxLength: 100 }, host: { type: "string", minLength: 1, maxLength: 253 }, port: { type: "integer", minimum: 1, maximum: 65535 }, protocol: { type: "string", enum: ["rdp", "vnc", "spice"] }, username: { type: "string", maxLength: 256 }, password: { type: "string", maxLength: 1024 }, autologin: { type: "boolean" } } } },
  }, async (request, reply) => {
    if (!isDatabaseReady() || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
    if (!validateMutation(request, reply)) return reply;
    const departmentId = managementDepartment(request, reply);
    if (!departmentId) return reply;
    const name = request.body.name.trim();
    const host = request.body.host.trim();
    if (!name || /[\u0000-\u001f\u007f]/.test(name) || !validRemoteHost(host)) return reply.code(400).send({ error: "Enter a destination name and a valid IP address or DNS host." });
    const gateway = gatewaySettings();
    if (!gateway.configured) return reply.code(503).send({ error: "The remote desktop gateway is not configured." });
    const encrypted = encryptPassword(request.body.password, gateway.jsonSecret);
    const id = randomUUID();
    try {
      const result = await pool.query(
        `INSERT INTO remote_desktop_destinations (id, department_id, name, host, port, protocol, username, password_ciphertext, password_iv, password_tag, autologin)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, department_id AS "departmentId", name, host, port, protocol, username, autologin, password_ciphertext, password_iv, password_tag`,
        [id, departmentId, name, host, request.body.port, request.body.protocol, request.body.username?.trim() ?? "", encrypted.ciphertext, encrypted.iv, encrypted.tag, request.body.autologin],
      );
      await pool.query("INSERT INTO remote_desktop_site_settings (department_id, managed) VALUES ($1, true) ON CONFLICT (department_id) DO UPDATE SET managed = true, updated_at = now()", [departmentId]);
      return reply.code(201).send(publicDestination(result.rows[0] as StoredDestination));
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "A destination with this name already exists at this site." });
      throw error;
    }
  });

  app.put<{ Params: { id: string }; Body: { name: string; host: string; port: number; protocol: RemoteProtocol; username?: string; password?: string; autologin: boolean } }>("/api/modules/remote-desktop/destinations/:id", {
    schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["name", "host", "port", "protocol", "autologin"], properties: { name: { type: "string", minLength: 1, maxLength: 100 }, host: { type: "string", minLength: 1, maxLength: 253 }, port: { type: "integer", minimum: 1, maximum: 65535 }, protocol: { type: "string", enum: ["rdp", "vnc", "spice"] }, username: { type: "string", maxLength: 256 }, password: { type: "string", maxLength: 1024 }, autologin: { type: "boolean" } } } },
  }, async (request, reply) => {
    if (!isDatabaseReady() || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
    if (!validateMutation(request, reply)) return reply;
    const departmentId = managementDepartment(request, reply);
    if (!departmentId) return reply;
    const name = request.body.name.trim();
    const host = request.body.host.trim();
    if (!name || /[\u0000-\u001f\u007f]/.test(name) || !validRemoteHost(host)) return reply.code(400).send({ error: "Enter a destination name and a valid IP address or DNS host." });
    const gateway = gatewaySettings();
    if (!gateway.configured) return reply.code(503).send({ error: "The remote desktop gateway is not configured." });
    const existing = await pool.query("SELECT password_ciphertext, password_iv, password_tag FROM remote_desktop_destinations WHERE id = $1 AND department_id = $2", [request.params.id, departmentId]);
    if (!existing.rowCount) return reply.code(404).send({ error: "This destination could not be found." });
    const password = request.body.password === undefined ? existing.rows[0] : encryptPassword(request.body.password, gateway.jsonSecret);
    const encrypted = "ciphertext" in password ? { password_ciphertext: password.ciphertext, password_iv: password.iv, password_tag: password.tag } : password;
    try {
      const result = await pool.query(
        `UPDATE remote_desktop_destinations SET name=$3, host=$4, port=$5, protocol=$6, username=$7,
                password_ciphertext=$8, password_iv=$9, password_tag=$10, autologin=$11, updated_at=now()
          WHERE id=$1 AND department_id=$2
          RETURNING id, department_id AS "departmentId", name, host, port, protocol, username, autologin, password_ciphertext, password_iv, password_tag`,
        [request.params.id, departmentId, name, host, request.body.port, request.body.protocol, request.body.username?.trim() ?? "", encrypted.password_ciphertext, encrypted.password_iv, encrypted.password_tag, request.body.autologin],
      );
      await pool.query("INSERT INTO remote_desktop_site_settings (department_id, managed) VALUES ($1, true) ON CONFLICT (department_id) DO UPDATE SET managed = true, updated_at = now()", [departmentId]);
      return publicDestination(result.rows[0] as StoredDestination);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "A destination with this name already exists at this site." });
      throw error;
    }
  });

  app.delete<{ Params: { id: string }; Headers: { "x-department-id"?: string } }>("/api/modules/remote-desktop/destinations/:id", {
    schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    if (!isDatabaseReady() || !pool) return reply.code(503).send({ error: "The account database is unavailable." });
    if (!validateMutation(request, reply)) return reply;
    const departmentId = managementDepartment(request, reply);
    if (!departmentId) return reply;
    const result = await pool.query("DELETE FROM remote_desktop_destinations WHERE id = $1 AND department_id = $2 RETURNING id", [request.params.id, departmentId]);
    if (!result.rowCount) return reply.code(404).send({ error: "This destination could not be found." });
    await pool.query("INSERT INTO remote_desktop_site_settings (department_id, managed) VALUES ($1, true) ON CONFLICT (department_id) DO UPDATE SET managed = true, updated_at = now()", [departmentId]);
    return { id: request.params.id };
  });

  app.get<{ Querystring: { destinationId?: string } }>("/api/modules/remote-desktop/status", async (request, reply) => {
    const access = await requireSystemLaptopAccess(request, reply);
    if (!access) return reply;
    if (controllerLease && !controllerLease.active && controllerLease.expiresAt <= Date.now()) controllerLease = null;
    const destinationId = request.query.destinationId ?? "";
    const controllerActive = Boolean(controllerLease?.active && controllerLease.departmentId === access.department && controllerLease.destinationId === destinationId);
    const controllerStarting = Boolean(controllerLease && !controllerLease.active && controllerLease.departmentId === access.department && controllerLease.destinationId === destinationId);
    const controllerBusy = Boolean(controllerLease && (controllerLease.departmentId !== access.department || controllerLease.destinationId !== destinationId));
    const destination = destinationId ? await resolveDestination(access.department, destinationId) : null;
    const settings = gatewaySettings();
    return {
      configured: Boolean(destination),
      destinations: (await listDestinationRows(access.department)).map(publicDestination),
      canControl: access.role === "site_admin",
      canTakeOver: true,
      controllerActive,
      controllerStarting,
      controllerBusy,
      message: destination ? undefined : "Add a remote desktop destination in Settings to continue.",
    };
  });

  app.get("/api/modules/remote-desktop/client.js", async (request, reply) => {
    if (!await requireSystemLaptopAccess(request, reply, true)) return reply;
    const settings = gatewaySettings();
    if (!settings.configured) return reply.code(503).send({ error: "The remote desktop gateway is not configured." });
    if (!cachedClientLibrary) {
      try {
        const response = await fetch(`${settings.apiUrl}/guacamole-common-js/all.min.js`, { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) return reply.code(502).send({ error: "The remote desktop client library could not be loaded." });
        const length = Number(response.headers.get("content-length"));
        if (Number.isFinite(length) && length > 5_000_000) return reply.code(502).send({ error: "The remote desktop client library is unexpectedly large." });
        cachedClientLibrary = await response.text();
        if (!cachedClientLibrary || cachedClientLibrary.length > 5_000_000) {
          cachedClientLibrary = null;
          return reply.code(502).send({ error: "The remote desktop client library is invalid." });
        }
      } catch {
        return reply.code(503).send({ error: "The remote desktop gateway could not be reached." });
      }
    }
    return reply.header("Content-Type", "text/javascript; charset=utf-8").header("Cache-Control", "private, max-age=3600").send(cachedClientLibrary);
  });

  app.post("/api/modules/remote-desktop/size", async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const access = await requireSystemLaptopAccess(request, reply);
    if (!access) return reply;
    const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
    const proxyTicket = typeof body.proxyTicket === "string" ? body.proxyTicket : "";
    const width = Number(body.width);
    const height = Number(body.height);
    const lease = controllerLease;
    if (!lease?.active || lease.ticket !== proxyTicket || lease.userId !== request.authenticatedUser?.id || lease.departmentId !== access.department) {
      return reply.code(403).send({ error: "Only the active controller can resize the remote desktop." });
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || width > 3840 || height < 200 || height > 2160) {
      return reply.code(400).send({ error: "The requested desktop size is out of range." });
    }
    lease.width = width;
    lease.height = height;
    return { width, height };
  });

  app.server.on("upgrade", (request, clientSocket, head) => {
    let incoming: URL;
    try { incoming = new URL(request.url ?? "/", "http://localhost"); }
    catch { return; }
    if (incoming.pathname !== "/api/modules/remote-desktop/tunnel") return;

    const key = request.headers["sec-websocket-key"];
    const originHeader = request.headers.origin;
    let origin: URL | null = null;
    let requestHost: URL | null = null;
    try {
      if (originHeader && request.headers.host) {
        origin = new URL(originHeader);
        requestHost = new URL(`http://${request.headers.host}`);
      }
    } catch { /* The origin check below rejects malformed host values. */ }
    const allowedOrigin = origin && requestHost && (process.env.SMART_CHURCH_WEB_ORIGIN
      ? origin.origin === process.env.SMART_CHURCH_WEB_ORIGIN
      : origin.hostname === requestHost.hostname && origin.protocol === "http:" && new Set([requestHost.port, "5173"]).has(origin.port));
    if (!allowedOrigin || request.headers.upgrade?.toLowerCase() !== "websocket" || typeof key !== "string" || Buffer.from(key, "base64").length !== 16) {
      return rejectUpgrade(clientSocket, 403, "The remote desktop tunnel request is invalid.");
    }

    const ticket = incoming.searchParams.get("SC_PROXY_TICKET") ?? "";
    const authToken = incoming.searchParams.get("token") ?? "";
    const connectionId = incoming.searchParams.get("GUAC_ID") ?? "";
    if (incoming.searchParams.get("GUAC_DATA_SOURCE") !== "json" || incoming.searchParams.get("GUAC_TYPE") !== "c") {
      return rejectUpgrade(clientSocket, 403, "The remote desktop session parameters are invalid.");
    }
    const authorization = proxyTickets.get(ticket);
    for (const [key, value] of proxyTickets) if (value.expiresAt <= Date.now()) proxyTickets.delete(key);
    if (!authorization || authorization.expiresAt <= Date.now() || authorization.authToken !== authToken || authorization.connectionId !== connectionId) {
      return rejectUpgrade(clientSocket, 403, "The remote desktop session is invalid or expired.");
    }
    if (authorization.role === "controller") {
      if (!controllerLease || controllerLease.ticket !== ticket || controllerLease.shareId !== authorization.shareId || controllerLease.destinationId !== authorization.destinationId) {
        return rejectUpgrade(clientSocket, 403, "The controller session is no longer active.");
      }
    } else if (authorization.role === "takeover") {
      if (!controllerLease || controllerLease.ticket !== ticket || controllerLease.active || controllerLease.shareId !== authorization.shareId || controllerLease.destinationId !== authorization.destinationId) {
        return rejectUpgrade(clientSocket, 409, "The control transfer has expired.");
      }
    } else if (!controllerLease?.active || controllerLease.shareId !== authorization.shareId || controllerLease.departmentId !== authorization.departmentId || controllerLease.destinationId !== authorization.destinationId) {
      return rejectUpgrade(clientSocket, 409, "The controller is no longer connected.");
    }
    if (authorization.active) return rejectUpgrade(clientSocket, 403, "This remote desktop session already has an active tunnel.");

    const settings = gatewaySettings();
    if (!settings.configured) return rejectUpgrade(clientSocket, 503, "Remote desktop is not configured.");
    const target = new URL(`${settings.apiUrl}/websocket-tunnel`);
    incoming.searchParams.delete("SC_PROXY_TICKET");
    target.search = incoming.searchParams.toString();
    const makeRequest = target.protocol === "https:" ? httpsRequest : httpRequest;
    const outgoing = makeRequest(target, {
      method: "GET",
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-key": key,
        "sec-websocket-version": request.headers["sec-websocket-version"] ?? "13",
        ...(request.headers["sec-websocket-protocol"] ? { "sec-websocket-protocol": request.headers["sec-websocket-protocol"] } : {}),
        ...(request.headers["sec-websocket-extensions"] ? { "sec-websocket-extensions": request.headers["sec-websocket-extensions"] } : {}),
        ...(request.headers.origin ? { origin: request.headers.origin } : {}),
        ...(request.headers["user-agent"] ? { "user-agent": request.headers["user-agent"] } : {}),
      },
    });
    const fail = () => rejectUpgrade(clientSocket, 502, "The remote desktop gateway could not open a tunnel.");
    outgoing.setTimeout(10_000, () => outgoing.destroy(new Error("Guacamole tunnel handshake timed out.")));
    outgoing.on("upgrade", (response, gatewaySocket, gatewayHead) => {
      authorization.active = true;
      if ((authorization.role === "controller" || authorization.role === "takeover") && controllerLease?.ticket === ticket) {
        controllerLease.active = true;
        controllerLease.expiresAt = Number.POSITIVE_INFINITY;
      }
      authorization.socket = clientSocket;
      const headers = response.rawHeaders.reduce<string[]>((result, value, index, all) => {
        if (index % 2 === 0) result.push(`${value}: ${all[index + 1]}`);
        return result;
      }, []);
      clientSocket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers.join("\r\n")}\r\n\r\n`);
      if (gatewayHead.length) clientSocket.write(gatewayHead);
      if (head.length) gatewaySocket.write(head);
      clientSocket.pipe(gatewaySocket);
      gatewaySocket.pipe(clientSocket);
      const close = () => {
        authorization.active = false;
        let controllerChanged = false;
        if ((authorization.role === "controller" || authorization.role === "takeover") && controllerLease?.ticket === ticket) {
          controllerLease = null;
          proxyTickets.delete(ticket);
          controllerChanged = true;
        }
        if (controllerChanged) realtime.publish("module:remote-desktop:changed", authorization.departmentId);
        clientSocket.destroy();
        gatewaySocket.destroy();
      };
      clientSocket.on("error", close);
      gatewaySocket.on("error", close);
      clientSocket.on("close", close);
      gatewaySocket.on("close", close);
    });
    outgoing.on("response", (response) => {
      response.resume();
      fail();
    });
    outgoing.on("error", fail);
    clientSocket.on("close", () => outgoing.destroy());
    outgoing.end();
  });

  app.post<{ Body: { destinationId: string; width?: number; height?: number; takeover?: boolean } }>("/api/modules/remote-desktop/session", async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const access = await requireSystemLaptopAccess(request, reply);
    if (!access) return reply;
    const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
    const destinationId = typeof body.destinationId === "string" ? body.destinationId : "";
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(destinationId)) return reply.code(400).send({ error: "Choose a remote desktop destination." });
    const resolved = await resolveDestination(access.department, destinationId);
    if (!resolved) return reply.code(503).send({ error: "This remote desktop destination is unavailable or the gateway is not configured." });
    const { settings, destination } = resolved;
    const now = Date.now();
    const isTakeover = body.takeover === true;
    if (controllerLease && !controllerLease.active && controllerLease.expiresAt <= now) controllerLease = null;
    let role: ProxyRole;
    let proxyTicket: string;
    let shareId: string;
    let width: number;
    let height: number;
    const takeoverFromTicket = isTakeover && controllerLease?.active && controllerLease.departmentId === access.department && controllerLease.destinationId === destinationId ? controllerLease.ticket : null;
    if (isTakeover) {
      if (!controllerLease?.active || controllerLease.departmentId !== access.department || controllerLease.destinationId !== destinationId) return reply.code(409).send({ error: "There is no active session at this location to take control of." });
      role = "takeover";
      proxyTicket = randomBytes(32).toString("base64url");
      shareId = controllerLease.shareId;
      width = controllerLease.width;
      height = controllerLease.height;
    } else if (!controllerLease) {
      if (access.role !== "site_admin") return reply.code(409).send({ error: "A site administrator must start the remote desktop before viewers can join." });
      role = "controller";
      proxyTicket = randomBytes(32).toString("base64url");
      shareId = randomBytes(24).toString("hex");
      width = Number.isInteger(body.width) ? Number(body.width) : 1440;
      height = Number.isInteger(body.height) ? Number(body.height) : 900;
      if (width < 320 || width > 3840 || height < 200 || height > 2160) return reply.code(400).send({ error: "The requested desktop size is out of range." });
      controllerLease = { userId: request.authenticatedUser!.id, departmentId: access.department, destinationId, ticket: proxyTicket, shareId, width, height, expiresAt: now + 60_000, active: false };
    } else {
      if (!controllerLease.active) return reply.code(409).send({ error: "The controller is starting. Try joining again in a moment." });
      if (controllerLease.departmentId !== access.department || controllerLease.destinationId !== destinationId) return reply.code(409).send({ error: "Another remote desktop destination is currently in use." });
      role = "viewer";
      proxyTicket = randomBytes(32).toString("base64url");
      shareId = controllerLease.shareId;
      width = controllerLease.width;
      height = controllerLease.height;
    }

    const releasePendingController = () => {
      if (role === "controller" && controllerLease?.ticket === proxyTicket && !controllerLease.active) controllerLease = null;
    };
    const data = encryptedAuthData(settings, destination, request.authenticatedUser!.username, shareId, role === "viewer" ? "viewer" : "controller", role === "takeover");
    let guacResponse: Response;
    try {
      guacResponse = await fetch(`${settings.apiUrl}/api/tokens`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      releasePendingController();
      return reply.code(503).send({ error: "The remote desktop gateway could not be reached." });
    }
    if (!guacResponse.ok) { releasePendingController(); return reply.code(502).send({ error: "The remote desktop gateway rejected the session request." }); }

    let authToken: unknown;
    try { authToken = (await guacResponse.json() as { authToken?: unknown }).authToken; }
    catch { releasePendingController(); return reply.code(502).send({ error: "The remote desktop gateway returned an invalid response." }); }
    if (typeof authToken !== "string" || authToken.length < 20 || authToken.length > 8192) {
      releasePendingController();
      return reply.code(502).send({ error: "The remote desktop gateway returned an invalid session token." });
    }

    let connectionResponse: Response;
    try {
      const connectionsUrl = new URL(`${settings.apiUrl}/api/session/data/json/connections`);
      connectionsUrl.searchParams.set("token", authToken);
      connectionResponse = await fetch(connectionsUrl, { signal: AbortSignal.timeout(10_000) });
    } catch {
      releasePendingController();
      return reply.code(503).send({ error: "The remote desktop gateway could not load the configured connection." });
    }
    if (!connectionResponse.ok) { releasePendingController(); return reply.code(502).send({ error: "The remote desktop gateway could not load the configured connection." }); }
    let connectionId: string | undefined;
    try {
      const connections = await connectionResponse.json() as Record<string, { name?: unknown; identifier?: unknown }>;
      const entry = Object.entries(connections).find(([id, connection]) => connection?.name === destination.name || id === destination.name);
      const id = entry?.[1]?.identifier ?? entry?.[0];
      if (typeof id === "string" && id.length > 0) connectionId = id;
    } catch { /* The error below reports a safe, user-facing gateway failure. */ }
    if (!connectionId) { releasePendingController(); return reply.code(502).send({ error: "The remote desktop gateway did not return the Remote desktop connection." }); }

    for (const [key, value] of proxyTickets) if (value.expiresAt <= now) proxyTickets.delete(key);
    proxyTickets.set(proxyTicket, { authToken, connectionId, expiresAt: now + 60 * 60_000, active: false, role, shareId, departmentId: access.department, destinationId, userId: request.authenticatedUser!.id });
    if (role === "takeover") {
      if (!controllerLease?.active || controllerLease.ticket !== takeoverFromTicket) {
        proxyTickets.delete(proxyTicket);
        return reply.code(409).send({ error: "The remote desktop control changed before the transfer could complete. Try again." });
      }
      const previousController = proxyTickets.get(takeoverFromTicket!);
      controllerLease = { userId: request.authenticatedUser!.id, departmentId: access.department, destinationId, ticket: proxyTicket, shareId, width, height, expiresAt: now + 60_000, active: false };
      previousController?.socket?.destroy();
    }
    return {
      authToken,
      dataSource: "json",
      connectionId,
      proxyTicket,
      role: role === "takeover" ? "controller" : role,
      width,
      height,
      tunnelUrl: "/api/modules/remote-desktop/tunnel",
      libraryUrl: `/api/modules/remote-desktop/client.js?departmentId=${encodeURIComponent(access.department)}`,
    };
  });
}
