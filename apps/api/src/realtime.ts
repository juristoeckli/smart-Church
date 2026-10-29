import { createHash } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";

const websocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const maxFrameBytes = 64 * 1024;

export type RealtimeIdentity = { id: string; role: string };
export type RealtimeMessageContext = { userId: string; departmentId: string };
export type RealtimeMessageHandler = (context: RealtimeMessageContext, payload: unknown) => void | Promise<void>;
type RealtimeClient = { socket: Socket; userId: string; departmentId: string; buffer: Buffer; lastPongAt: number; heartbeat: NodeJS.Timeout; messageWindowAt: number; messageCount: number };
type Authenticate = (request: IncomingMessage) => Promise<RealtimeIdentity | null>;
type Authorize = (identity: RealtimeIdentity, departmentId: string) => Promise<boolean>;
type IsOriginAllowed = (request: IncomingMessage, origin: string | undefined) => boolean;

function writeFrame(socket: Socket, opcode: number, payload: Buffer) {
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, payload.length]);
  } else if (payload.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

function reject(socket: Socket, status: number, message: string) {
  if (socket.destroyed) return;
  const body = `${message}\n`;
  socket.end(`HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Bad Request"}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function forwardedProtocol(request: IncomingMessage) {
  const forwarded = request.headers["x-forwarded-proto"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]?.trim();
  return value === "https" || Boolean((request.socket as Socket & { encrypted?: boolean }).encrypted) ? "https" : "http";
}

export class RealtimeHub {
  private readonly clients = new Set<RealtimeClient>();
  private readonly messageHandlers = new Map<string, Set<RealtimeMessageHandler>>();

  constructor(
    private readonly server: Server,
    private readonly authenticate: Authenticate,
    private readonly authorize: Authorize,
    private readonly isOriginAllowed: IsOriginAllowed,
  ) {
    this.server.on("upgrade", this.onUpgrade);
  }

  publish(topic: string, departmentId: string, payload?: unknown) {
    const message = Buffer.from(JSON.stringify({ topic, departmentId, payload }));
    for (const client of this.clients) {
      if (client.departmentId === departmentId && !client.socket.destroyed) writeFrame(client.socket, 1, message);
    }
  }

  onMessage(topic: string, handler: RealtimeMessageHandler) {
    const handlers = this.messageHandlers.get(topic) ?? new Set<RealtimeMessageHandler>();
    handlers.add(handler);
    this.messageHandlers.set(topic, handlers);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) this.messageHandlers.delete(topic);
    };
  }

  close() {
    this.server.off("upgrade", this.onUpgrade);
    for (const client of this.clients) this.disconnect(client);
  }

  private onUpgrade = (request: IncomingMessage, socket: Socket, head: Buffer) => {
    let url: URL;
    try { url = new URL(request.url ?? "/", "http://localhost"); }
    catch { return; }
    if (url.pathname !== "/api/realtime") return;
    void this.accept(request, socket, head, url);
  };

  private async accept(request: IncomingMessage, socket: Socket, head: Buffer, url: URL) {
    const key = request.headers["sec-websocket-key"];
    const connection = request.headers.connection?.toLowerCase().split(",").map((part) => part.trim()) ?? [];
    if (request.method !== "GET" || request.headers.upgrade?.toLowerCase() !== "websocket" || !connection.includes("upgrade") || request.headers["sec-websocket-version"] !== "13" || typeof key !== "string" || Buffer.from(key, "base64").length !== 16) {
      reject(socket, 400, "Invalid WebSocket handshake.");
      return;
    }
    if (!this.isOriginAllowed(request, request.headers.origin)) {
      reject(socket, 403, "The WebSocket origin is not allowed.");
      return;
    }
    const departmentId = url.searchParams.get("departmentId") ?? "";
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(departmentId)) {
      reject(socket, 400, "Choose a valid location.");
      return;
    }
    let identity: RealtimeIdentity | null;
    try { identity = await this.authenticate(request); }
    catch { identity = null; }
    if (!identity) {
      reject(socket, 401, "Sign in to continue.");
      return;
    }
    let allowed = false;
    try { allowed = await this.authorize(identity, departmentId); }
    catch { allowed = false; }
    if (!allowed) {
      reject(socket, 403, "You do not have access to this location.");
      return;
    }
    if (socket.destroyed) return;

    const acceptKey = createHash("sha1").update(key + websocketGuid).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey}\r\n\r\n`);
    const client: RealtimeClient = {
      socket,
      userId: identity.id,
      departmentId,
      buffer: Buffer.from(head),
      lastPongAt: Date.now(),
      messageWindowAt: Date.now(),
      messageCount: 0,
      heartbeat: setInterval(() => {
        if (socket.destroyed) return;
        if (Date.now() - client.lastPongAt > 60_000) return socket.destroy();
        writeFrame(socket, 9, Buffer.alloc(0));
      }, 25_000),
    };
    client.heartbeat.unref();
    this.clients.add(client);
    socket.on("data", (chunk: Buffer) => this.consume(client, chunk));
    socket.on("close", () => this.disconnect(client));
    socket.on("error", () => this.disconnect(client));
    if (client.buffer.length) this.consume(client, Buffer.alloc(0));
    writeFrame(socket, 1, Buffer.from(JSON.stringify({ topic: "realtime:connected", departmentId })));
  }

  private consume(client: RealtimeClient, chunk: Buffer) {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    while (client.buffer.length >= 2) {
      const first = client.buffer[0]!;
      const second = client.buffer[1]!;
      const opcode = first & 0x0f;
      if (!(first & 0x80) || !(second & 0x80)) return client.socket.destroy();
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (client.buffer.length < 4) return;
        length = client.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (client.buffer.length < 10) return;
        const largeLength = client.buffer.readBigUInt64BE(2);
        if (largeLength > BigInt(maxFrameBytes)) return client.socket.destroy();
        length = Number(largeLength);
        offset = 10;
      }
      if (length > maxFrameBytes) return client.socket.destroy();
      if (client.buffer.length < offset + 4 + length) return;
      const mask = client.buffer.subarray(offset, offset + 4);
      offset += 4;
      const payload = Buffer.from(client.buffer.subarray(offset, offset + length));
      for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index & 3]!;
      client.buffer = client.buffer.subarray(offset + length);
      if (opcode === 8) { client.socket.end(); return; }
      if (opcode === 9) { writeFrame(client.socket, 10, payload); continue; }
      if (opcode === 10) { client.lastPongAt = Date.now(); continue; }
      if (opcode !== 1) return client.socket.destroy();
      this.dispatchClientMessage(client, payload);
    }
  }

  private dispatchClientMessage(client: RealtimeClient, payload: Buffer) {
    const now = Date.now();
    if (now - client.messageWindowAt >= 10_000) { client.messageWindowAt = now; client.messageCount = 0; }
    client.messageCount += 1;
    if (client.messageCount > 60) return client.socket.destroy();
    let message: unknown;
    try { message = JSON.parse(payload.toString("utf8")); }
    catch { return client.socket.destroy(); }
    if (!message || typeof message !== "object" || Array.isArray(message)) return client.socket.destroy();
    const candidate = message as { topic?: unknown; payload?: unknown };
    if (typeof candidate.topic !== "string" || candidate.topic.length > 120) return client.socket.destroy();
    const handlers = this.messageHandlers.get(candidate.topic);
    if (!handlers) return;
    for (const handler of handlers) {
      void Promise.resolve(handler({ userId: client.userId, departmentId: client.departmentId }, candidate.payload)).catch(() => undefined);
    }
  }

  private disconnect(client: RealtimeClient) {
    if (!this.clients.delete(client)) return;
    clearInterval(client.heartbeat);
  }
}

export function websocketRequestProtocol(request: IncomingMessage) {
  return forwardedProtocol(request);
}
