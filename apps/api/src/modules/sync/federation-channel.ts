import { createHash, randomBytes, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Socket } from "node:net";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { canonicalRequest, fingerprintPublicKey, protocolVersion, signBytes, verifyBytes, type LocalIdentity } from "./federation-crypto.js";

// Node's built-in WebSocket dispatches ErrorEvent on failed connections, but
// some Node 24 builds do not expose ErrorEvent globally. Without this small
// compatibility class, an unreachable peer can crash the API process.
if (typeof globalThis.ErrorEvent !== "function") {
  class NodeErrorEvent extends Event {
    readonly error: unknown;
    readonly message: string;

    constructor(type: string, init: { error?: unknown; message?: string; cancelable?: boolean } = {}) {
      super(type, { cancelable: init.cancelable });
      this.error = init.error;
      this.message = init.message ?? "";
    }
  }
  Object.defineProperty(globalThis, "ErrorEvent", { configurable: true, writable: true, value: NodeErrorEvent });
}

const path = "/api/modules/sync/federation/v1/channel";
const websocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const maxTextMessageBytes = 900 * 1024;
const maxBinaryMessageBytes = 256 * 1024 * 1024;
const maxRequestDurationMs = 5 * 60_000;
const allowedHeaders = new Set(["accept", "content-type", "x-sc-protocol", "x-sc-installation", "x-sc-timestamp", "x-sc-nonce", "x-sc-signature"]);
const outboundAddressMode = process.env.SMART_CHURCH_SYNC_OUTBOUND_ADDRESS?.trim().toLowerCase() ?? "auto";
const outboundInitiationEnabled = outboundAddressMode !== "0.0.0.0";

type Peer = { installation_id: string; base_url: string | null; public_key_pem: string };
type RpcRequest = { type: "request"; id: string; method: string; path: string; headers: Record<string, string>; body: string; responseMode?: "json" | "binary" };
type RpcResponse = { type: "response"; id: string; status: number; headers: Record<string, string>; body: string };
type RpcBinaryResponse = { type: "binary-response"; id: string; status: number; headers: Record<string, string>; bytes: Buffer };
type Pending = { peerInstallationId: string; resolve: (value: RpcResponse | RpcBinaryResponse) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout };

function webSocketFailure(event: Event, host: string) {
  const errorEvent = event as Event & { error?: unknown; message?: unknown };
  const messages: string[] = [];
  const codes: string[] = [];
  let current: unknown = errorEvent.error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current !== "object") break;
    const item = current as { message?: unknown; code?: unknown; cause?: unknown };
    if (typeof item.message === "string" && item.message) messages.push(item.message);
    if (typeof item.code === "string" && item.code) codes.push(item.code);
    current = item.cause;
  }
  if (typeof errorEvent.message === "string" && errorEvent.message) messages.push(errorEvent.message);
  const code = codes[0];
  if (codes.some((value) => value === "ENOTFOUND" || value === "EAI_AGAIN")) return { reason: `DNS lookup for ${host} failed (${code}). Check the server URL and DNS from the server running Smart-Church.`, code };
  if (codes.includes("ECONNREFUSED")) return { reason: `Connection to ${host} was refused. Check that the server is running and its HTTPS/API port is reachable.`, code };
  if (codes.some((value) => value === "ETIMEDOUT" || value === "EHOSTUNREACH" || value === "ENETUNREACH")) return { reason: `The network connection to ${host} timed out or is unreachable (${code}). Check routing, firewall rules, and the HTTPS/API port.`, code };
  if (codes.some((value) => value.startsWith("CERT_") || value.startsWith("ERR_TLS_") || value === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || value === "DEPTH_ZERO_SELF_SIGNED_CERT")) return { reason: `TLS certificate validation failed for ${host} (${code}). Use a trusted certificate whose name matches the server URL.`, code };
  const detail = messages.join("; ");
  const status = detail.match(/(?:status(?: code)?|HTTP)\s*[:=]?\s*(\d{3})/i)?.[1];
  if (status) {
    const hint = status === "401" || status === "403"
      ? "Check the saved peer identity, HTTPS termination, and proxy forwarding of WebSocket upgrade headers."
      : status === "404"
        ? "Check that the Sync module is enabled and the proxy forwards the federation WebSocket path."
        : "Check the remote server logs and reverse-proxy configuration.";
    return { reason: `${host} rejected the WebSocket handshake with HTTP ${status}. ${hint}`, code: `HTTP_${status}` };
  }
  const sanitized = detail.replace(/wss?:\/\/[^\s?]+(?:\?[^\s]*)?/gi, `WebSocket endpoint on ${host}`).slice(0, 180);
  if (sanitized && !/network error or non-101 status code/i.test(sanitized)) return { reason: `Could not establish a WebSocket connection to ${host}: ${sanitized}`, code };
  return { reason: `Could not establish a WebSocket connection to ${host}. The remote endpoint rejected the handshake or the network connection failed. Check that Sync is enabled and the HTTPS proxy forwards WebSocket upgrades.`, code };
}

async function inspectWebSocketHandshake(endpoint: URL, identity: LocalIdentity, bootstrap: boolean) {
  const timestamp = String(Date.now());
  const nonce = randomBytes(24).toString("base64url");
  const values = { ...(bootstrap ? { bootstrap: "1" } : {}), installationId: identity.installationId, timestamp, nonce, protocol: protocolVersion };
  const parameters = new URLSearchParams({ ...values, ...(bootstrap ? { publicKey: Buffer.from(identity.publicKeyPem).toString("base64url") } : {}) });
  const signedTarget = `${path}?${new URLSearchParams(values).toString()}`;
  parameters.set("signature", signBytes(identity.privateKeyPem, canonicalRequest("GET", signedTarget, timestamp, nonce, "")));
  const target = new URL(endpoint);
  target.protocol = target.protocol === "wss:" ? "https:" : target.protocol === "ws:" ? "http:" : target.protocol;
  target.search = parameters.toString();
  const request = (target.protocol === "https:" ? httpsRequest : httpRequest)({
    hostname: target.hostname,
    port: target.port || undefined,
    path: `${target.pathname}${target.search}`,
    method: "GET",
    headers: {
      connection: "Upgrade",
      upgrade: "websocket",
      "sec-websocket-version": "13",
      "sec-websocket-key": randomBytes(16).toString("base64"),
    },
  });
  return new Promise<{ status: number | null; body: string; code?: string }>((resolve) => {
    let settled = false;
    const finish = (value: { status: number | null; body: string; code?: string }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    request.setTimeout(5000, () => request.destroy(Object.assign(new Error("The diagnostic WebSocket handshake timed out."), { code: "ETIMEDOUT" })));
    request.on("response", (response) => {
      const chunks: Buffer[] = [];
      let remaining = 512;
      response.on("data", (chunk: Buffer) => {
        if (remaining <= 0) return;
        const selected = chunk.subarray(0, remaining);
        chunks.push(selected);
        remaining -= selected.length;
      });
      response.on("end", () => finish({ status: response.statusCode ?? null, body: Buffer.concat(chunks).toString("utf8") }));
      response.resume();
    });
    request.on("upgrade", (response, socket) => {
      socket.destroy();
      finish({ status: response.statusCode ?? 101, body: "" });
    });
    request.on("error", (error: NodeJS.ErrnoException) => finish({ status: null, body: error.message.slice(0, 240), code: error.code }));
    request.end();
  });
}

function explainHandshakeFailure(host: string, result: { status: number | null; body: string; code?: string }, fallback: string) {
  if (result.status === 101) return `The remote server accepted the authenticated WebSocket upgrade, but the WebSocket client then failed. Check for a proxy or network device closing the connection immediately after upgrade.`;
  if (result.status === 403 && /bootstrap identity conflicts with the saved peer record/i.test(result.body)) return `The remote server has a saved peer record for this installation with a different or revoked key. In Sync settings on ${host}, delete/forget the old server identity for this installation, then retry.`;
  if (result.status === 403 && /require HTTPS/i.test(result.body)) return `The remote server rejected the WebSocket because its HTTPS proxy did not forward the secure protocol indicator. Check that the proxy sets X-Forwarded-Proto: https.`;
  if (result.status === 403 && /not an enabled inbound Sync peer/i.test(result.body)) return `The remote server does not have an enabled inbound Sync connection for this installation. Check the trust record and WebSocket direction on the remote server.`;
  if (result.status === 404 && /Sync module is disabled/i.test(result.body)) return `The remote server rejected the connection because its Sync module is disabled.`;
  if (result.status === 401 && /signature is invalid/i.test(result.body)) return `The remote server rejected the signed WebSocket identity. Its advertised public key and private signing key may not match; verify the installation identity on both servers.`;
  if (result.status === 401 && /identity is invalid or stale/i.test(result.body)) return `The remote server rejected the WebSocket identity as invalid or stale. Check both servers' clocks and Sync protocol versions.`;
  if (result.status === 429) return `The remote server is rate limiting Sync handshake attempts. Wait one minute and retry.`;
  if (result.status !== null) {
    const body = result.body.trim().replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/wss?:\/\/[^\s?]+(?:\?[^\s]*)?/gi, "WebSocket endpoint").slice(0, 240);
    return `The remote server rejected the authenticated WebSocket handshake with HTTP ${result.status}${body ? `: ${body}` : ""}.`;
  }
  if (result.code === "ENOTFOUND" || result.code === "EAI_AGAIN") return `DNS lookup for ${host} failed (${result.code}). Check DNS from the local Smart-Church server.`;
  if (result.code === "ECONNREFUSED") return `Connection to ${host} was refused. Check the remote HTTPS/API listener and firewall.`;
  if (result.code === "ETIMEDOUT" || result.code === "EHOSTUNREACH" || result.code === "ENETUNREACH") return `The diagnostic connection to ${host} timed out or is unreachable (${result.code}). Check routing and firewall rules.`;
  return fallback;
}

function closePeerSocket(socket: Socket | WebSocket, code = 1002, reason = "Invalid message") {
  if (socket instanceof WebSocket) socket.close(code, reason);
  else socket.destroy();
}

function serverFrame(opcode: number, payload: Buffer) {
  let header: Buffer;
  if (payload.length < 126) header = Buffer.from([0x80 | opcode, payload.length]);
  else if (payload.length <= 0xffff) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
  return Buffer.concat([header, payload]);
}

function rejectUpgrade(socket: Socket, status: number, message: string) {
  if (socket.destroyed) return;
  const body = `${message}\n`;
  socket.end(`HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Bad Request"}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function parseFrameBuffer(state: { buffer: Buffer; lastPongAt?: number }, onMessage: (opcode: number, payload: Buffer) => void, socket: Socket) {
  while (state.buffer.length >= 2) {
    const first = state.buffer[0]!;
    const second = state.buffer[1]!;
    const opcode = first & 0x0f;
    const final = Boolean(first & 0x80);
    const masked = Boolean(second & 0x80);
    if (!final || !masked || (first & 0x70)) return socket.destroy();
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) { if (state.buffer.length < 4) return; length = state.buffer.readUInt16BE(2); offset = 4; }
    else if (length === 127) {
      if (state.buffer.length < 10) return;
      const large = state.buffer.readBigUInt64BE(2);
      if (large > BigInt(maxBinaryMessageBytes)) return socket.destroy();
      length = Number(large); offset = 10;
    }
    if (length > (opcode === 2 ? maxBinaryMessageBytes : maxTextMessageBytes)) return socket.destroy();
    if (state.buffer.length < offset + 4 + length) return;
    const mask = state.buffer.subarray(offset, offset + 4);
    offset += 4;
    const payload = Buffer.from(state.buffer.subarray(offset, offset + length));
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index & 3]!;
    state.buffer = state.buffer.subarray(offset + length);
    if (opcode === 8) { socket.end(); return; }
    if (opcode === 9) { socket.write(serverFrame(10, payload)); continue; }
    if (opcode === 10) { state.lastPongAt = Date.now(); continue; }
    if (opcode !== 1 && opcode !== 2) return socket.destroy();
    onMessage(opcode, payload);
  }
}

export class FederationChannels {
  private readonly outgoing = new Map<string, WebSocket>();
  private readonly connecting = new Map<string, Promise<void>>();
  private readonly incoming = new Map<string, { socket: Socket; buffer: Buffer; lastPongAt: number; heartbeat: NodeJS.Timeout | null; bootstrap?: { publicKeyPem: string } }>();
  private readonly bootstrapSockets = new WeakMap<Socket, { publicKeyPem: string }>();
  private readonly pending = new Map<string, Pending>();
  private readonly outboundErrors = new Map<string, string>();
  private readonly loggedOutboundErrors = new Map<string, string>();
  private readonly bootstrapAttempts = new Map<string, { count: number; expiresAt: number }>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private enabled = false;
  private readonly onUpgrade = (request: IncomingMessage, socket: Socket, head: Buffer) => {
    let url: URL;
    try { url = new URL(request.url ?? "/", "http://localhost"); } catch { return; }
    if (url.pathname !== path) return;
    void this.accept(request, socket, head, url);
  };

  constructor(private readonly app: FastifyInstance, private readonly server: Server, private readonly pool: Pool, private readonly getIdentity: () => Promise<LocalIdentity>, private readonly internalRequestToken: string) {
    this.server.on("upgrade", this.onUpgrade);
  }

  has(installationId: string) {
    const outgoing = this.outgoing.get(installationId);
    const incoming = this.incoming.get(installationId);
    return outgoing?.readyState === WebSocket.OPEN || Boolean(incoming && !incoming.socket.destroyed);
  }

  connectedPeerCount() {
    const peers = new Set<string>();
    for (const [id, socket] of this.outgoing) if (socket.readyState === WebSocket.OPEN) peers.add(id);
    for (const [id, item] of this.incoming) if (!item.socket.destroyed) peers.add(id);
    return peers.size;
  }

  status(installationId: string) {
    const outgoing = this.outgoing.get(installationId);
    const incoming = this.incoming.get(installationId);
    return {
      outbound: outgoing?.readyState === WebSocket.OPEN,
      inbound: Boolean(incoming && !incoming.socket.destroyed),
      outboundError: this.outboundErrors.get(installationId) ?? null,
    };
  }

  disconnectPeer(installationId: string) {
    const outgoing = this.outgoing.get(installationId);
    if (outgoing) {
      this.outgoing.delete(installationId);
      outgoing.close(1008, "Peer connection revoked");
    }
    const incoming = this.incoming.get(installationId);
    if (incoming) {
      if (incoming.heartbeat) clearInterval(incoming.heartbeat);
      this.incoming.delete(installationId);
      const reason = Buffer.from("Peer connection revoked");
      const payload = Buffer.alloc(2 + reason.length);
      payload.writeUInt16BE(1008, 0);
      reason.copy(payload, 2);
      incoming.socket.end(serverFrame(8, payload));
    }
    this.outboundErrors.delete(installationId);
  }

  async start() {
    if (this.closed || this.enabled) return;
    this.enabled = true;
    await this.connectTrustedPeers();
    this.reconnectTimer = setInterval(() => { void this.connectTrustedPeers().catch(() => undefined); }, 15_000);
    this.reconnectTimer.unref();
  }

  async stop() {
    this.enabled = false;
    if (this.reconnectTimer) clearInterval(this.reconnectTimer);
    this.reconnectTimer = null;
    for (const socket of this.outgoing.values()) socket.close(1000, "Sync module disabled");
    const closePayload = Buffer.alloc(2);
    closePayload.writeUInt16BE(1000);
    for (const item of this.incoming.values()) { if (item.heartbeat) clearInterval(item.heartbeat); item.socket.end(serverFrame(8, closePayload)); }
    this.outgoing.clear(); this.incoming.clear(); this.connecting.clear();
    for (const pending of this.pending.values()) { clearTimeout(pending.timeout); pending.reject(new Error("The Sync module is disabled.")); }
    this.pending.clear();
  }

  close() {
    this.closed = true;
    this.server.off("upgrade", this.onUpgrade);
    void this.stop();
  }

  async request(peer: Peer, method: string, target: string, headers: Record<string, string>, body: string, timeoutMs: number) {
    await this.waitForChannel(peer, timeoutMs);
    const connection = this.outgoing.get(peer.installation_id);
    if (connection?.readyState === WebSocket.OPEN) return this.expectJson(await this.send(connection, peer.installation_id, method, target, headers, body, timeoutMs));
    const reverse = this.incoming.get(peer.installation_id);
    if (reverse && !reverse.socket.destroyed) return this.expectJson(await this.send(reverse.socket, peer.installation_id, method, target, headers, body, timeoutMs));
    throw new Error("No authenticated WebSocket channel is open to this peer.");
  }

  async requestBinary(peer: Peer, method: string, target: string, headers: Record<string, string>, body: string, timeoutMs: number) {
    await this.waitForChannel(peer, timeoutMs);
    const connection = this.outgoing.get(peer.installation_id);
    if (connection?.readyState === WebSocket.OPEN) return this.expectBinary(await this.send(connection, peer.installation_id, method, target, headers, body, timeoutMs, "binary"));
    const reverse = this.incoming.get(peer.installation_id);
    if (reverse && !reverse.socket.destroyed) return this.expectBinary(await this.send(reverse.socket, peer.installation_id, method, target, headers, body, timeoutMs, "binary"));
    throw new Error("No authenticated WebSocket channel is open to this peer.");
  }

  async requestBootstrap(baseUrl: string, identity: LocalIdentity, method: string, target: string, headers: Record<string, string>, body: string, timeoutMs: number) {
    const timestamp = String(Date.now());
    const nonce = randomBytes(24).toString("base64url");
    const parameters = new URLSearchParams({ bootstrap: "1", installationId: identity.installationId, timestamp, nonce, protocol: protocolVersion, publicKey: Buffer.from(identity.publicKeyPem).toString("base64url") });
    const signedTarget = `${path}?${new URLSearchParams({ bootstrap: "1", installationId: identity.installationId, timestamp, nonce, protocol: protocolVersion }).toString()}`;
    parameters.set("signature", signBytes(identity.privateKeyPem, canonicalRequest("GET", signedTarget, timestamp, nonce, "")));
    const origin = new URL(baseUrl);
    origin.protocol = origin.protocol === "https:" ? "wss:" : "ws:";
    origin.pathname = path;
    origin.search = parameters.toString();
    const socket = new WebSocket(origin);
    socket.binaryType = "arraybuffer";
    const id = randomUUID();
    const request: RpcRequest = { type: "request", id, method, path: target, headers, body };
    const payload = JSON.stringify(request);
    if (Buffer.byteLength(payload) > maxTextMessageBytes) throw new Error("The federation WebSocket request exceeds its message limit.");
    const response = await new Promise<RpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const reason = `The federation WebSocket bootstrap to ${origin.host} timed out. Check network reachability, firewall rules, and WebSocket forwarding on the HTTPS/API port.`;
        this.app.log.warn({ module: "sync", remoteHost: origin.host, phase: "bootstrap", errorCode: "ETIMEDOUT", reason }, "Sync WebSocket bootstrap timed out.");
        socket.close();
        reject(new Error(reason));
      }, Math.min(maxRequestDurationMs, timeoutMs));
      timeout.unref();
      let diagnosing = false;
      const finish = (error?: Error, value?: RpcResponse) => { clearTimeout(timeout); socket.removeEventListener("message", onMessage); socket.removeEventListener("error", onError); socket.removeEventListener("close", onClose); socket.close(); error ? reject(error) : resolve(value!); };
      const onMessage = (event: MessageEvent) => {
        try {
          const data = typeof event.data === "string" ? event.data : Buffer.from(event.data as ArrayBuffer).toString("utf8");
          const result = JSON.parse(data) as RpcResponse;
          if (result.type !== "response" || result.id !== id || !Number.isInteger(result.status) || typeof result.body !== "string" || !result.headers || typeof result.headers !== "object") throw new Error("The remote server returned an invalid bootstrap response.");
          finish(undefined, result);
        } catch (error) { finish(error instanceof Error ? error : new Error("The remote server returned an invalid bootstrap response.")); }
      };
      const onError = (event: Event) => {
        if (diagnosing) return;
        diagnosing = true;
        const failure = webSocketFailure(event, origin.host);
        void inspectWebSocketHandshake(origin, identity, true).then((handshake) => {
          const reason = explainHandshakeFailure(origin.host, handshake, failure.reason);
          const handshakeResponse = handshake.body.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 240);
          this.app.log.warn({ module: "sync", remoteHost: origin.host, phase: "bootstrap", reason, errorCode: handshake.code ?? failure.code, handshakeStatus: handshake.status, handshakeResponse: handshakeResponse || undefined }, "Sync WebSocket bootstrap connection failed.");
          finish(new Error(reason));
        }).catch(() => {
          this.app.log.warn({ module: "sync", remoteHost: origin.host, phase: "bootstrap", reason: failure.reason, errorCode: failure.code }, "Sync WebSocket bootstrap connection failed.");
          finish(new Error(failure.reason));
        });
      };
      const onClose = (event: CloseEvent) => {
        if (diagnosing) return;
        const reason = `The remote WebSocket closed before completing bootstrap (code ${event.code}${event.reason ? `: ${event.reason}` : ""}). Check the remote Sync module and server logs.`;
        this.app.log.warn({ module: "sync", remoteHost: origin.host, phase: "bootstrap", closeCode: event.code, closeReason: event.reason }, "Sync WebSocket bootstrap closed before a response.");
        finish(new Error(reason));
      };
      socket.addEventListener("message", onMessage, { once: true });
      socket.addEventListener("error", onError, { once: true });
      socket.addEventListener("close", onClose, { once: true });
      socket.addEventListener("open", () => { try { socket.send(payload); } catch (error) { finish(error instanceof Error ? error : new Error("Could not send the WebSocket bootstrap request.")); } }, { once: true });
    });
    return { status: response.status, headers: response.headers, body: response.body };
  }

  private expectJson(response: RpcResponse | RpcBinaryResponse) { if (response.type !== "response") throw new Error("The peer returned an unexpected binary response."); return response; }
  private expectBinary(response: RpcResponse | RpcBinaryResponse) { if (response.type !== "binary-response") throw new Error("The peer returned an unexpected text response."); return response; }

  private async connectTrustedPeers() {
    if (this.closed || !this.enabled || !outboundInitiationEnabled) return;
    const peers = await this.pool.query<Peer>("SELECT installation_id,base_url,public_key_pem FROM sync_peers WHERE trust_state='trusted' AND outbound_enabled=TRUE AND base_url IS NOT NULL ORDER BY installation_id");
    for (const peer of peers.rows) {
      const current = this.outgoing.get(peer.installation_id);
      if (current && current.readyState < WebSocket.CLOSING) continue;
      void this.connect(peer).catch((error) => {
        const reason = error instanceof Error ? error.message : "The outbound WebSocket connection failed before opening.";
        this.logOutboundFailure(peer.installation_id, peer.base_url, reason, error);
      });
    }
  }

  private async connect(peer: Peer) {
    if (!outboundInitiationEnabled || !peer.base_url || this.closed || !this.enabled) return;
    const allowed = await this.pool.query("SELECT 1 FROM sync_peers WHERE installation_id=$1 AND trust_state='trusted' AND outbound_enabled=TRUE", [peer.installation_id]);
    if (!allowed.rowCount) return;
    const current = this.outgoing.get(peer.installation_id);
    if (current && current.readyState < WebSocket.CLOSING) return this.connecting.get(peer.installation_id);
    const existingAttempt = this.connecting.get(peer.installation_id);
    if (existingAttempt) return existingAttempt;
    const identity = await this.getIdentity();
    const timestamp = String(Date.now());
    const nonce = randomBytes(24).toString("base64url");
    const parameters = new URLSearchParams({ installationId: identity.installationId, timestamp, nonce, protocol: protocolVersion });
    const signedTarget = `${path}?${parameters.toString()}`;
    const signature = signBytes(identity.privateKeyPem, canonicalRequest("GET", signedTarget, timestamp, nonce, ""));
    parameters.set("signature", signature);
    const origin = new URL(peer.base_url);
    origin.protocol = origin.protocol === "https:" ? "wss:" : "ws:";
    origin.pathname = path;
    origin.search = parameters.toString();
    this.outboundErrors.delete(peer.installation_id);
    const socket = new WebSocket(origin);
    socket.binaryType = "arraybuffer";
    this.outgoing.set(peer.installation_id, socket);
    socket.addEventListener("message", (event) => this.receivePeerMessage(peer.installation_id, socket, event.data));
    socket.addEventListener("close", (event) => {
      if (this.outgoing.get(peer.installation_id) === socket) this.outgoing.delete(peer.installation_id);
      if (event.code !== 1000 && !this.outboundErrors.has(peer.installation_id)) {
        const reason = `The remote WebSocket closed the channel (code ${event.code}${event.reason ? `: ${event.reason}` : ""}). Check the remote Sync module and server logs.`;
        this.outboundErrors.set(peer.installation_id, reason);
        this.logOutboundFailure(peer.installation_id, origin.host, reason);
      }
      this.failPeerRequests(peer.installation_id);
    });
    socket.addEventListener("error", (event) => {
      if (this.outgoing.get(peer.installation_id) === socket) this.outgoing.delete(peer.installation_id);
      const failure = webSocketFailure(event, origin.host);
      this.outboundErrors.set(peer.installation_id, failure.reason);
      this.logOutboundFailure(peer.installation_id, origin.host, failure.reason, (event as Event & { error?: unknown }).error, failure.code);
    });
    const attempt = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const reason = `The federation WebSocket connection to ${origin.host} timed out after 10 seconds. Check network reachability, firewall rules, and WebSocket forwarding on the HTTPS/API port.`;
        this.outboundErrors.set(peer.installation_id, reason);
        this.logOutboundFailure(peer.installation_id, origin.host, reason, undefined, "ETIMEDOUT");
        socket.close();
        reject(new Error(reason));
      }, 10_000);
      timeout.unref();
      socket.addEventListener("open", () => { clearTimeout(timeout); this.outboundErrors.delete(peer.installation_id); this.loggedOutboundErrors.delete(peer.installation_id); this.app.log.info({ module: "sync", peerInstallationId: peer.installation_id, remoteHost: origin.host }, "Authenticated Sync WebSocket channel connected."); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error(this.outboundErrors.get(peer.installation_id) ?? "The federation WebSocket connection failed.")); }, { once: true });
    }).finally(() => { if (this.connecting.get(peer.installation_id) === attempt) this.connecting.delete(peer.installation_id); });
    this.connecting.set(peer.installation_id, attempt);
    return attempt;
  }

  private async waitForChannel(peer: Peer, timeoutMs: number) {
    if (outboundInitiationEnabled && !this.has(peer.installation_id) && peer.base_url) void this.connect(peer).catch(() => undefined);
    const deadline = Date.now() + Math.min(timeoutMs, 15_000);
    while (!this.has(peer.installation_id) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    if (!this.has(peer.installation_id)) throw new Error("No authenticated WebSocket channel is open to this peer.");
  }

  private logOutboundFailure(peerInstallationId: string, remoteHost: string | null, reason: string, error?: unknown, errorCode?: string) {
    const safeReason = reason.replace(/wss?:\/\/([^/\s?#]+)[^\s]*/gi, "WebSocket endpoint at $1");
    this.outboundErrors.set(peerInstallationId, safeReason);
    if (this.loggedOutboundErrors.get(peerInstallationId) === safeReason) return;
    this.loggedOutboundErrors.set(peerInstallationId, safeReason);
    let causeMessage: string | undefined;
    if (error && typeof error === "object") {
      const candidate = error as { cause?: unknown };
      const cause = candidate.cause && typeof candidate.cause === "object" ? candidate.cause as { message?: unknown; code?: unknown } : undefined;
      if (typeof cause?.message === "string") causeMessage = cause.message.slice(0, 180).replace(/wss?:\/\/[^\s?]+(?:\?[^\s]*)?/gi, "WebSocket endpoint");
      errorCode ??= typeof cause?.code === "string" ? cause.code : undefined;
    }
    let safeHost = remoteHost;
    try { if (remoteHost && remoteHost.includes("://")) safeHost = new URL(remoteHost).host; } catch { safeHost = "invalid server URL"; }
    this.app.log.warn({ module: "sync", peerInstallationId, remoteHost: safeHost ?? "unknown remote host", reason: safeReason, errorCode, cause: causeMessage }, "Could not establish the outbound Sync WebSocket channel.");
  }

  private async accept(request: IncomingMessage, socket: Socket, head: Buffer, url: URL) {
    if (!this.enabled || this.closed) return rejectUpgrade(socket, 404, "The Sync module is disabled.");
    const key = request.headers["sec-websocket-key"];
    const connection = request.headers.connection?.toLowerCase().split(",").map((part) => part.trim()) ?? [];
    if (request.method !== "GET" || request.headers.upgrade?.toLowerCase() !== "websocket" || !connection.includes("upgrade") || request.headers["sec-websocket-version"] !== "13" || typeof key !== "string" || Buffer.from(key, "base64").length !== 16) return rejectUpgrade(socket, 400, "Invalid federation WebSocket handshake.");
    if (process.env.NODE_ENV === "production" && request.headers["x-forwarded-proto"] !== "https") return rejectUpgrade(socket, 403, "Federation WebSockets require HTTPS.");
    const installationId = url.searchParams.get("installationId") ?? "";
    const timestamp = url.searchParams.get("timestamp") ?? "";
    const nonce = url.searchParams.get("nonce") ?? "";
    const signature = url.searchParams.get("signature") ?? "";
    const protocol = url.searchParams.get("protocol") ?? "";
    const bootstrap = url.searchParams.get("bootstrap") === "1";
    const publicKeyEncoded = url.searchParams.get("publicKey") ?? "";
    const expectedQueryKeys = bootstrap ? ["bootstrap", "installationId", "timestamp", "nonce", "protocol", "publicKey", "signature"] : ["installationId", "timestamp", "nonce", "protocol", "signature"];
    if (expectedQueryKeys.some((name) => url.searchParams.getAll(name).length !== 1) || [...url.searchParams.keys()].length !== expectedQueryKeys.length
      || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(installationId)
      || !/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 5 * 60_000 || !/^[A-Za-z0-9_-]{32,128}$/.test(nonce)
      || !/^[A-Za-z0-9_-]{80,256}$/.test(signature) || protocol !== protocolVersion || (bootstrap && publicKeyEncoded.length > 8192)) return rejectUpgrade(socket, 401, "The federation WebSocket identity is invalid or stale.");
    let bootstrapKey: string | undefined;
    if (bootstrap) {
      try { bootstrapKey = Buffer.from(publicKeyEncoded, "base64url").toString("utf8"); if (fingerprintPublicKey(bootstrapKey).length !== 95) throw new Error("Invalid key"); }
      catch { return rejectUpgrade(socket, 401, "The federation WebSocket bootstrap key is invalid."); }
    }
    const peer = await this.pool.query<Peer & { trust_state: string; inbound_enabled: boolean }>("SELECT installation_id,base_url,public_key_pem,trust_state,inbound_enabled FROM sync_peers WHERE installation_id=$1", [installationId]);
    if (bootstrap) {
      if (peer.rows[0]?.trust_state === "revoked" || (peer.rowCount && peer.rows[0].public_key_pem !== bootstrapKey)) return rejectUpgrade(socket, 403, "This bootstrap identity conflicts with the saved peer record.");
    } else if (!peer.rowCount || peer.rows[0].trust_state !== "trusted" || !peer.rows[0].inbound_enabled) return rejectUpgrade(socket, 403, "This server is not an enabled inbound Sync peer.");
    const signedTarget = `${path}?${new URLSearchParams({ ...(bootstrap ? { bootstrap: "1" } : {}), installationId, timestamp, nonce, protocol }).toString()}`;
    const handshakePublicKey = bootstrapKey ?? peer.rows[0].public_key_pem;
    if (!verifyBytes(handshakePublicKey, canonicalRequest("GET", signedTarget, timestamp, nonce, ""), signature)) return rejectUpgrade(socket, 401, "The federation WebSocket signature is invalid.");
    if (bootstrap) {
      const address = request.socket.remoteAddress ?? "unknown";
      if (this.bootstrapAttempts.size > 5000) for (const [key, attempt] of this.bootstrapAttempts) if (attempt.expiresAt <= Date.now()) this.bootstrapAttempts.delete(key);
      const attempt = this.bootstrapAttempts.get(address);
      if (attempt && attempt.expiresAt > Date.now() && attempt.count >= 60) return rejectUpgrade(socket, 429, "Too many federation bootstrap attempts.");
      this.bootstrapAttempts.set(address, attempt && attempt.expiresAt > Date.now()
        ? { count: attempt.count + 1, expiresAt: attempt.expiresAt }
        : { count: 1, expiresAt: Date.now() + 60_000 });
    }
    const used = await this.pool.query("INSERT INTO sync_request_nonces(installation_id,nonce,expires_at) VALUES($1,$2,now()+interval '10 minutes') ON CONFLICT DO NOTHING RETURNING nonce", [installationId, nonce]);
    if (!used.rowCount) return rejectUpgrade(socket, 401, "The federation WebSocket handshake was already used.");
    const prior = this.incoming.get(installationId);
    if (!bootstrap && prior) { if (prior.heartbeat) clearInterval(prior.heartbeat); prior.socket.end(serverFrame(8, Buffer.alloc(0))); }
    const acceptKey = createHash("sha1").update(key + websocketGuid).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey}\r\n\r\n`);
    const state: { socket: Socket; buffer: Buffer; lastPongAt: number; heartbeat: NodeJS.Timeout | null } = { socket, buffer: Buffer.from(head), lastPongAt: Date.now(), heartbeat: null };
    if (bootstrapKey) this.bootstrapSockets.set(socket, { publicKeyPem: bootstrapKey });
    state.heartbeat = setInterval(() => {
      if (socket.destroyed) return;
      if (Date.now() - state.lastPongAt > 60_000) return socket.destroy();
      socket.write(serverFrame(9, Buffer.alloc(0)));
    }, 25_000);
    state.heartbeat.unref();
    if (!bootstrap) this.incoming.set(installationId, state);
    await this.pool.query("UPDATE sync_peers SET last_seen_at=now(),last_error=NULL WHERE installation_id=$1", [installationId]);
    socket.on("data", (chunk: Buffer) => {
      state.buffer = Buffer.concat([state.buffer, chunk]);
      if (state.buffer.length > maxBinaryMessageBytes + 32) return socket.destroy();
      parseFrameBuffer(state, (opcode, payload) => {
        if (opcode === 2) return this.handleBinaryResponse(installationId, payload);
        void this.handlePeerMessage(installationId, socket, payload.toString("utf8"));
      }, socket);
    });
    socket.on("close", () => { if (state.heartbeat) clearInterval(state.heartbeat); if (this.incoming.get(installationId) === state) this.incoming.delete(installationId); this.failPeerRequests(installationId); });
    socket.on("error", () => { if (state.heartbeat) clearInterval(state.heartbeat); if (this.incoming.get(installationId) === state) this.incoming.delete(installationId); });
    if (state.buffer.length) parseFrameBuffer(state, (opcode, payload) => {
      if (opcode === 2) return this.handleBinaryResponse(installationId, payload);
      void this.handlePeerMessage(installationId, socket, payload.toString("utf8"));
    }, socket);
  }

  private async handlePeerMessage(installationId: string, socket: Socket | WebSocket, text: string) {
    if (Buffer.byteLength(text) > maxTextMessageBytes) return closePeerSocket(socket, 1009, "Message too large");
    let message: RpcRequest | RpcResponse;
    try { message = JSON.parse(text) as RpcRequest | RpcResponse; } catch { return socket instanceof WebSocket ? socket.close(1002, "Invalid message") : socket.destroy(); }
    if (message.type === "response") { this.resolvePending(installationId, message); return; }
    const request = message;
    if (request.type !== "request" || !/^[\da-f-]{36}$/i.test(request.id) || !["GET", "POST", "PUT", "DELETE"].includes(request.method)
      || typeof request.path !== "string" || !request.path.startsWith("/api/modules/sync/federation/v1/") || request.path.includes("/channel")
      || typeof request.body !== "string" || Buffer.byteLength(request.body) > 760 * 1024 || !request.headers || typeof request.headers !== "object" || Array.isArray(request.headers)
      || (request.responseMode !== undefined && request.responseMode !== "json" && request.responseMode !== "binary")
      || (request.responseMode === "binary" && (request.method !== "POST" || !request.path.endsWith("/redundancy/pull-snapshot")))) return closePeerSocket(socket);
    const bootstrap = socket instanceof WebSocket ? undefined : this.bootstrapSockets.get(socket);
    if (!bootstrap && request.method === "POST" && request.path === "/api/modules/sync/federation/v1/pair") return closePeerSocket(socket, 1008, "Pairing requires the restricted bootstrap channel");
    if (bootstrap) {
      const bootstrapPath = "/api/modules/sync/federation/v1/identity";
      const pairPath = "/api/modules/sync/federation/v1/pair";
      const statusPath = "/api/modules/sync/federation/v1/status";
      if (!((request.method === "GET" && request.path === bootstrapPath) || (request.method === "POST" && request.path === pairPath) || (request.method === "GET" && request.path === statusPath))) return closePeerSocket(socket, 1008, "Bootstrap channel is restricted");
      if (request.path === pairPath) {
        try {
          const pair = JSON.parse(request.body) as { identity?: { installationId?: unknown; publicKeyPem?: unknown } };
          if (pair.identity?.installationId !== installationId || pair.identity.publicKeyPem !== bootstrap.publicKeyPem) return closePeerSocket(socket, 1008, "Pairing identity does not match the signed WebSocket identity");
        } catch { return closePeerSocket(socket, 1008, "Invalid pairing request"); }
      }
    }
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (!allowedHeaders.has(name.toLowerCase()) || typeof value !== "string" || value.length > 4096) return closePeerSocket(socket);
      headers[name.toLowerCase()] = value;
    }
    const bootstrapIdentityLookup = Boolean(bootstrap && request.method === "GET" && request.path === "/api/modules/sync/federation/v1/identity" && headers["x-sc-installation"] === undefined);
    if (headers["x-sc-installation"] !== installationId && !bootstrapIdentityLookup) return closePeerSocket(socket);
    let result: { statusCode: number; headers: Record<string, number | string | string[] | undefined>; body: string; rawPayload: Buffer };
    try {
      const injected = await this.app.inject({
        method: request.method as "GET" | "POST" | "PUT" | "DELETE",
        url: request.path,
        headers: {
          ...headers,
          "x-sc-internal-federation-channel": this.internalRequestToken,
          ...(bootstrap ? { "x-sc-federation-bootstrap": "true" } : {}),
          "x-forwarded-proto": process.env.NODE_ENV === "production" ? "https" : "http",
        },
        ...(request.body ? { payload: request.body } : {}),
      });
      result = { statusCode: injected.statusCode, headers: injected.headers as Record<string, number | string | string[] | undefined>, body: injected.body, rawPayload: injected.rawPayload };
    } catch (error) {
      this.app.log.error({ err: error, peerInstallationId: installationId, method: request.method, path: request.path }, "A federation WebSocket request failed before producing a signed response.");
      const errorBody = JSON.stringify({ error: error instanceof Error ? error.message : "The tunneled request failed." });
      result = { statusCode: 500, headers: { "content-type": "application/json" }, body: errorBody, rawPayload: Buffer.from(errorBody) };
    }
    const responseHeaders: Record<string, string> = {};
    for (const name of ["content-type", "x-sc-protocol", "x-sc-response-signature", "cache-control"]) {
      const value = result.headers[name];
      if (typeof value === "string") responseHeaders[name] = value;
    }
    if (request.responseMode === "binary") {
      const payload = result.rawPayload;
      const metadata = Buffer.from(JSON.stringify({ type: "binary-response", id: request.id, status: result.statusCode, headers: responseHeaders }));
      const frame = Buffer.allocUnsafe(4 + metadata.length + payload.length);
      frame.writeUInt32BE(metadata.length, 0); metadata.copy(frame, 4); payload.copy(frame, 4 + metadata.length);
      if (frame.length > maxBinaryMessageBytes) return closePeerSocket(socket, 1009, "Snapshot too large");
      if (socket instanceof WebSocket) { if (socket.readyState === WebSocket.OPEN) socket.send(frame); }
      else if (!socket.destroyed) socket.write(serverFrame(2, frame));
      return;
    }
    const response: RpcResponse = { type: "response", id: request.id, status: result.statusCode, headers: responseHeaders, body: result.body };
    const frame = Buffer.from(JSON.stringify(response));
    if (frame.length > maxTextMessageBytes) return closePeerSocket(socket, 1009, "Message too large");
    if (socket instanceof WebSocket) { if (socket.readyState === WebSocket.OPEN) socket.send(frame.toString("utf8")); }
    else if (!socket.destroyed) socket.write(serverFrame(1, frame));
  }

  private async send(socket: WebSocket | Socket, installationId: string, method: string, target: string, headers: Record<string, string>, body: string, timeoutMs: number, responseMode: "json" | "binary" = "json"): Promise<RpcResponse | RpcBinaryResponse> {
    if (Buffer.byteLength(body) > 760 * 1024) throw new Error("The federation WebSocket request exceeds its transfer limit.");
    const id = randomUUID();
    const request: RpcRequest = { type: "request", id, method, path: target, headers, body, responseMode };
    const payload = JSON.stringify(request);
    if (Buffer.byteLength(payload) > maxTextMessageBytes) throw new Error("The federation WebSocket request exceeds its message limit.");
    return new Promise<RpcResponse | RpcBinaryResponse>((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error("The federation WebSocket request timed out.")); }, Math.min(maxRequestDurationMs, timeoutMs));
      timeout.unref();
      this.pending.set(id, { peerInstallationId: installationId, resolve, reject, timeout });
      try {
        if (socket instanceof WebSocket) socket.send(payload);
        else socket.write(serverFrame(1, Buffer.from(payload)));
      } catch (error) { clearTimeout(timeout); this.pending.delete(id); reject(error instanceof Error ? error : new Error("The federation WebSocket request failed.")); }
    });
  }

  private receivePeerMessage(installationId: string, socket: WebSocket, data: unknown) {
    void (async () => {
      if (typeof data === "string") { await this.handlePeerMessage(installationId, socket, data); return; }
      let bytes: Buffer;
      if (data instanceof ArrayBuffer) bytes = Buffer.from(data);
      else if (ArrayBuffer.isView(data)) bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      else if (data instanceof Blob) bytes = Buffer.from(await data.arrayBuffer());
      else return;
      this.handleBinaryResponse(installationId, bytes);
    })().catch(() => undefined);
  }

  private handleBinaryResponse(installationId: string, payload: Buffer) {
    if (payload.length < 4 || payload.length > maxBinaryMessageBytes) return;
    const headerLength = payload.readUInt32BE(0);
    if (headerLength < 2 || headerLength > 16_384 || payload.length < 4 + headerLength) return;
    let header: Omit<RpcBinaryResponse, "bytes">;
    try { header = JSON.parse(payload.subarray(4, 4 + headerLength).toString("utf8")) as Omit<RpcBinaryResponse, "bytes">; } catch { return; }
    if (header.type !== "binary-response" || typeof header.id !== "string" || !Number.isInteger(header.status) || !header.headers || typeof header.headers !== "object") return;
    const response: RpcBinaryResponse = { ...header, bytes: payload.subarray(4 + headerLength) };
    this.resolvePending(installationId, response);
  }

  private resolvePending(installationId: string, response: RpcResponse | RpcBinaryResponse) {
    const pending = this.pending.get(response.id);
    if (!pending || pending.peerInstallationId !== installationId) return;
    clearTimeout(pending.timeout);
    this.pending.delete(response.id);
    pending.resolve(response);
  }

  private failPeerRequests(_installationId: string) {
    // Requests time out if their route closes while in flight. Keeping the
    // pending map keyed by opaque request ID prevents one peer closing from
    // rejecting another peer's unrelated request.
  }
}
