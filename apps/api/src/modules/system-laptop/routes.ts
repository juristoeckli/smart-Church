import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { ModuleServerContext } from "../module-sdk.js";

type LaptopRole = "controller" | "viewer";
type ProxyRole = LaptopRole | "takeover";
type ProxyTicket = { authToken: string; connectionId: string; expiresAt: number; active: boolean; role: ProxyRole; shareId: string; departmentId: string; userId: string; socket?: import("node:stream").Duplex };
type ControllerLease = { userId: string; departmentId: string; ticket: string; shareId: string; width: number; height: number; expiresAt: number; active: boolean };
const proxyTickets = new Map<string, ProxyTicket>();
let controllerLease: ControllerLease | null = null;

function connectionSettings() {
  const jsonSecret = process.env.SYSTEM_LAPTOP_JSON_SECRET_KEY ?? "";
  const host = process.env.SYSTEM_LAPTOP_RDP_HOST?.trim() ?? "";
  const username = process.env.SYSTEM_LAPTOP_RDP_USERNAME ?? "";
  const password = process.env.SYSTEM_LAPTOP_RDP_PASSWORD ?? "";
  const apiUrl = process.env.SYSTEM_LAPTOP_GUACAMOLE_API_URL?.trim().replace(/\/$/, "") ?? "";
  const validHost = host.length <= 253 && /^[A-Za-z0-9.:-]+$/.test(host);
  const port = process.env.SYSTEM_LAPTOP_RDP_PORT?.trim() || "3389";
  const validPort = /^\d{1,5}$/.test(port) && Number(port) >= 1 && Number(port) <= 65535;
  const validUrl = (value: string) => {
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
    } catch { return false; }
  };
  const configured = /^[\da-f]{32}$/i.test(jsonSecret) && validHost && validPort && Boolean(username && password) && validUrl(apiUrl);
  return { configured, jsonSecret, host, username, password, apiUrl, port };
}

function rejectUpgrade(socket: import("node:stream").Duplex, status: number, message: string) {
  if (socket.destroyed) return;
  const body = `${message}\n`;
  const reason = status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : status === 404 ? "Not Found" : status === 409 ? "Conflict" : status === 503 ? "Service Unavailable" : "Bad Gateway";
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function encryptedAuthData(settings: ReturnType<typeof connectionSettings>, username: string, shareId: string, role: LaptopRole, joinShared = false) {
  const key = Buffer.from(settings.jsonSecret, "hex");
  const payload = Buffer.from(JSON.stringify({
    username,
    expires: Date.now() + 60_000,
    connections: {
      "System Laptop": role === "viewer" || joinShared ? {
        join: shareId,
        ...(role === "viewer" ? { parameters: { "read-only": "true" } } : {}),
      } : {
        id: shareId,
        protocol: "rdp",
        parameters: {
          hostname: settings.host,
          port: settings.port,
          username: settings.username,
          password: settings.password,
          "ignore-cert": "true",
          "disable-audio": "false",
          "enable-drive": "false",
          "enable-printing": "false",
          "resize-method": "display-update",
        },
      },
    },
  }));
  const signature = createHmac("sha256", key).update(payload).digest();
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16));
  return Buffer.concat([cipher.update(Buffer.concat([signature, payload])), cipher.final()]).toString("base64");
}

export function registerModuleRoutes(app: FastifyInstance, dependencies: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation } = dependencies;
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
    if (!access?.enabled_modules?.includes("system-laptop")) {
      reply.code(404).send({ error: "System Laptop is not enabled for this location." });
      return null;
    }
    return { department, role: access.role as "site_admin" | "member" };
  }

  app.get("/api/modules/system-laptop/status", async (request, reply) => {
    const access = await requireSystemLaptopAccess(request, reply);
    if (!access) return reply;
    if (controllerLease && !controllerLease.active && controllerLease.expiresAt <= Date.now()) controllerLease = null;
    const controllerActive = Boolean(controllerLease?.active && controllerLease.departmentId === access.department);
    const controllerStarting = Boolean(controllerLease && !controllerLease.active && controllerLease.departmentId === access.department);
    const controllerBusy = Boolean(controllerLease && controllerLease.departmentId !== access.department);
    const settings = connectionSettings();
    return {
      configured: settings.configured,
      canControl: access.role === "site_admin",
      canTakeOver: true,
      controllerActive,
      controllerStarting,
      controllerBusy,
      message: settings.configured ? undefined : "Set the System Laptop RDP and Guacamole settings in the private environment configuration.",
    };
  });

  app.get("/api/modules/system-laptop/client.js", async (request, reply) => {
    if (!await requireSystemLaptopAccess(request, reply, true)) return reply;
    const settings = connectionSettings();
    if (!settings.configured) return reply.code(503).send({ error: "System Laptop has not been configured on this server." });
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

  app.post("/api/modules/system-laptop/size", async (request, reply) => {
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
    if (incoming.pathname !== "/api/modules/system-laptop/tunnel") return;

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
      if (!controllerLease || controllerLease.ticket !== ticket || controllerLease.shareId !== authorization.shareId) {
        return rejectUpgrade(clientSocket, 403, "The controller session is no longer active.");
      }
    } else if (authorization.role === "takeover") {
      if (!controllerLease || controllerLease.ticket !== ticket || controllerLease.active || controllerLease.shareId !== authorization.shareId) {
        return rejectUpgrade(clientSocket, 409, "The control transfer has expired.");
      }
    } else if (!controllerLease?.active || controllerLease.shareId !== authorization.shareId || controllerLease.departmentId !== authorization.departmentId) {
      return rejectUpgrade(clientSocket, 409, "The controller is no longer connected.");
    }
    if (authorization.active) return rejectUpgrade(clientSocket, 403, "This remote desktop session already has an active tunnel.");

    const settings = connectionSettings();
    if (!settings.configured) return rejectUpgrade(clientSocket, 503, "System Laptop is not configured.");
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
        if ((authorization.role === "controller" || authorization.role === "takeover") && controllerLease?.ticket === ticket) {
          controllerLease = null;
          proxyTickets.delete(ticket);
        }
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

  app.post("/api/modules/system-laptop/session", async (request, reply) => {
    if (!validateMutation(request, reply)) return reply;
    const access = await requireSystemLaptopAccess(request, reply);
    if (!access) return reply;
    const settings = connectionSettings();
    if (!settings.configured) return reply.code(503).send({ error: "System Laptop has not been configured on this server." });

    const now = Date.now();
    const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
    const isTakeover = body.takeover === true;
    if (controllerLease && !controllerLease.active && controllerLease.expiresAt <= now) controllerLease = null;
    let role: ProxyRole;
    let proxyTicket: string;
    let shareId: string;
    let width: number;
    let height: number;
    const takeoverFromTicket = isTakeover && controllerLease?.active && controllerLease.departmentId === access.department ? controllerLease.ticket : null;
    if (isTakeover) {
      if (!controllerLease?.active || controllerLease.departmentId !== access.department) return reply.code(409).send({ error: "There is no active session at this location to take control of." });
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
      controllerLease = { userId: request.authenticatedUser!.id, departmentId: access.department, ticket: proxyTicket, shareId, width, height, expiresAt: now + 60_000, active: false };
    } else {
      if (!controllerLease.active) return reply.code(409).send({ error: "The controller is starting. Try joining again in a moment." });
      if (controllerLease.departmentId !== access.department) return reply.code(409).send({ error: "The active remote desktop belongs to another location." });
      role = "viewer";
      proxyTicket = randomBytes(32).toString("base64url");
      shareId = controllerLease.shareId;
      width = controllerLease.width;
      height = controllerLease.height;
    }

    const releasePendingController = () => {
      if (role === "controller" && controllerLease?.ticket === proxyTicket && !controllerLease.active) controllerLease = null;
    };
    const data = encryptedAuthData(settings, request.authenticatedUser!.username, shareId, role === "viewer" ? "viewer" : "controller", role === "takeover");
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
      const entry = Object.entries(connections).find(([id, connection]) => connection?.name === "System Laptop" || id === "System Laptop");
      const id = entry?.[1]?.identifier ?? entry?.[0];
      if (typeof id === "string" && id.length > 0) connectionId = id;
    } catch { /* The error below reports a safe, user-facing gateway failure. */ }
    if (!connectionId) { releasePendingController(); return reply.code(502).send({ error: "The remote desktop gateway did not return the System Laptop connection." }); }

    for (const [key, value] of proxyTickets) if (value.expiresAt <= now) proxyTickets.delete(key);
    proxyTickets.set(proxyTicket, { authToken, connectionId, expiresAt: now + 60 * 60_000, active: false, role, shareId, departmentId: access.department, userId: request.authenticatedUser!.id });
    if (role === "takeover") {
      if (!controllerLease?.active || controllerLease.ticket !== takeoverFromTicket) {
        proxyTickets.delete(proxyTicket);
        return reply.code(409).send({ error: "The remote desktop control changed before the transfer could complete. Try again." });
      }
      const previousController = proxyTickets.get(takeoverFromTicket!);
      controllerLease = { userId: request.authenticatedUser!.id, departmentId: access.department, ticket: proxyTicket, shareId, width, height, expiresAt: now + 60_000, active: false };
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
      tunnelUrl: "/api/modules/system-laptop/tunnel",
      libraryUrl: `/api/modules/system-laptop/client.js?departmentId=${encodeURIComponent(access.department)}`,
    };
  });
}
