import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workerPath = fileURLToPath(new URL("./worker-entry.js", import.meta.url));
const websocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const maxMessageBytes = 1_000_000;

type WorkerState = "unconfigured" | "starting" | "ready" | "backoff" | "failed" | "stopped";
type WorkerMemory = { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number };
type WorkerMetrics = { uptimeSeconds: number; memory: WorkerMemory; python: { uptimeSeconds: number | null; rssBytes: number | null } };
type PendingRequest = { resolve: (value: unknown) => void; reject: (error: Error & { code?: string }) => void; timer: NodeJS.Timeout };
type WorkerSocket = { socket: import("node:net").Socket; buffer: Buffer; registered: boolean; closed: boolean; child?: ChildProcess };

function loopback(address: string | undefined) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function frame(opcode: number, payload: Buffer) {
  const header = payload.length < 126
    ? Buffer.from([0x80 | opcode, payload.length])
    : payload.length <= 0xffff
      ? Buffer.from([0x80 | opcode, 126, payload.length >> 8, payload.length & 0xff])
      : Buffer.from([0x80 | opcode, 127, 0, 0, 0, 0, (payload.length >>> 24) & 0xff, (payload.length >>> 16) & 0xff, (payload.length >>> 8) & 0xff, payload.length & 0xff]);
  return Buffer.concat([header, payload]);
}

function send(socket: import("node:net").Socket, value: unknown) {
  if (socket.destroyed) return;
  socket.write(frame(1, Buffer.from(JSON.stringify(value))));
}

function parseFrames(connection: WorkerSocket, onMessage: (value: unknown) => void, onPong: () => void) {
  connection.socket.on("data", (chunk) => {
    connection.buffer = Buffer.concat([connection.buffer, chunk]);
    while (connection.buffer.length >= 2) {
      const first = connection.buffer[0]!;
      const second = connection.buffer[1]!;
      const opcode = first & 0x0f;
      const final = (first & 0x80) !== 0;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (!final || !masked || (first & 0x70) !== 0) return connection.socket.destroy();
      if (length === 126) {
        if (connection.buffer.length < 4) return;
        length = connection.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (connection.buffer.length < 10) return;
        const largeLength = connection.buffer.readBigUInt64BE(2);
        if (largeLength > BigInt(maxMessageBytes)) return connection.socket.destroy();
        length = Number(largeLength);
        offset = 10;
      }
      if (length > maxMessageBytes) return connection.socket.destroy();
      if (connection.buffer.length < offset + 4 + length) return;
      const mask = connection.buffer.subarray(offset, offset + 4);
      offset += 4;
      const payload = Buffer.from(connection.buffer.subarray(offset, offset + length));
      for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index & 3]!;
      connection.buffer = connection.buffer.subarray(offset + length);
      if (opcode === 8) { connection.socket.end(frame(8, payload)); return; }
      if (opcode === 9) { connection.socket.write(frame(10, payload)); continue; }
      if (opcode === 10) { onPong(); continue; }
      if (opcode !== 1) return connection.socket.destroy();
      try { onMessage(JSON.parse(payload.toString("utf8"))); }
      catch { connection.socket.destroy(); return; }
    }
  });
}

function unavailable(message: string) {
  return Object.assign(new Error(message), { code: "UNAVAILABLE" as const });
}

export class VideoWorkerSupervisor {
  private child: ChildProcess | null = null;
  private connection: WorkerSocket | null = null;
  private readonly token = randomBytes(32).toString("base64url");
  private readonly pending = new Map<string, PendingRequest>();
  private restartTimer: NodeJS.Timeout | null = null;
  private restartCount = 0;
  private stateValue: WorkerState;
  private errorValue: string | null = null;
  private closing = false;
  private enabled = false;
  private nextRestartAt = 0;
  private childStartedAt: number | null = null;
  private workerMetrics: WorkerMetrics | null = null;

  constructor(private readonly server: Server, private readonly port: number, private readonly configured: boolean, private readonly onWorkerLog: (message: string) => void = () => undefined) {
    this.stateValue = configured ? "starting" : "unconfigured";
    this.server.on("upgrade", this.onUpgrade);
  }

  get state() { return { state: this.stateValue, error: this.errorValue }; }

  get diagnostics() {
    return {
      status: this.stateValue,
      error: this.errorValue,
      uptimeSeconds: this.child && this.childStartedAt !== null ? Math.floor((Date.now() - this.childStartedAt) / 1000) : null,
      memory: this.child ? this.workerMetrics?.memory ?? null : null,
      processes: this.child && this.workerMetrics?.python ? [{ name: "Python process", ...this.workerMetrics.python }] : [],
    };
  }

  start() {
    if (this.closing) return;
    this.enabled = true;
    if (this.configured) this.launch();
  }

  stop() {
    this.enabled = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const child = this.child;
    this.child = null;
    this.connection?.socket.destroy();
    this.connection = null;
    child?.kill();
    this.childStartedAt = null;
    this.workerMetrics = null;
    this.rejectAll("The Video module is disabled for this installation.");
    this.stateValue = this.configured ? "stopped" : "unconfigured";
  }

  restart() {
    if (this.closing) throw new Error("The Video worker supervisor is shutting down.");
    if (!this.configured) throw new Error("The Video worker is not configured.");
    if (!this.enabled) throw new Error("The Video module is disabled for this installation.");
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const child = this.child;
    this.child = null;
    this.connection?.socket.destroy();
    this.connection = null;
    child?.kill();
    this.rejectAll("The Video worker is restarting.");
    this.restartCount = 0;
    this.errorValue = null;
    this.stateValue = "starting";
    this.launch();
  }

  private onUpgrade = (request: IncomingMessage, socket: import("node:net").Socket, head: Buffer) => {
    if (request.url !== "/internal/workers/video" || !loopback(socket.remoteAddress)) return;
    if (!this.enabled || this.closing) return socket.destroy();
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string" || request.headers.upgrade?.toLowerCase() !== "websocket") return socket.destroy();
    const accept = createHash("sha1").update(key + websocketGuid).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const connection: WorkerSocket = { socket, buffer: Buffer.alloc(0), registered: false, closed: false, child: this.child ?? undefined };
    this.connection?.socket.destroy();
    this.connection = connection;
    let lastPong = Date.now();
    const heartbeat = setInterval(() => {
      if (socket.destroyed) return;
      if (Date.now() - lastPong > 40_000) return socket.destroy();
      socket.write(frame(9, Buffer.alloc(0)));
    }, 20_000);
    heartbeat.unref();
    const registrationTimeout = setTimeout(() => { if (!connection.registered) socket.destroy(); }, 5000);
    parseFrames(connection, (value) => {
      if (!value || typeof value !== "object") return socket.destroy();
      const message = value as Record<string, unknown>;
      if (!connection.registered) {
        const candidate = typeof message.token === "string" ? Buffer.from(message.token) : Buffer.alloc(0);
        const expected = Buffer.from(this.token);
        if (message.type !== "register" || candidate.length !== expected.length || !timingSafeEqual(candidate, expected) || connection.child !== this.child) return socket.destroy();
        connection.registered = true;
        clearTimeout(registrationTimeout);
        this.stateValue = "ready";
        this.errorValue = null;
        send(socket, { type: "registered" });
        return;
      }
      if (!connection.registered) return socket.destroy();
      if (message.type === "response" && typeof message.id === "string") {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (typeof message.error === "string") pending.reject(Object.assign(new Error(message.error), { code: "OPERATION_FAILED" }));
        else pending.resolve(message.result);
      } else if (message.type === "worker-ready") {
        this.stateValue = "ready";
      }
    }, () => { lastPong = Date.now(); });
    socket.on("close", () => {
      clearInterval(heartbeat);
      clearTimeout(registrationTimeout);
      connection.closed = true;
      if (this.connection === connection) this.connection = null;
      if (!this.closing && connection.child === this.child) {
        this.errorValue = "Video worker connection closed.";
        connection.child?.kill();
      }
    });
    socket.on("error", () => socket.destroy());
    if (head.length) socket.unshift(head);
  };

  private launch() {
    if (this.closing || !this.enabled || this.child || !this.configured) return;
    this.stateValue = "starting";
    let child: ChildProcess;
    try {
      child = fork(workerPath, [], {
        cwd: resolve(process.cwd()),
        env: { ...process.env, SMART_CHURCH_CORE_WS_URL: `ws://127.0.0.1:${this.port}/internal/workers/video`, SMART_CHURCH_WORKER_TOKEN: this.token },
        stdio: ["ignore", "inherit", "pipe", "ipc"],
        execArgv: [],
        windowsHide: true,
      });
    } catch (error) {
      this.scheduleRestart(`Could not start the video worker: ${error instanceof Error ? error.message : "process creation failed"}.`);
      return;
    }
    this.child = child;
    this.childStartedAt = Date.now();
    this.workerMetrics = null;
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      let pending = "";
      child.stderr.on("data", (chunk: string) => {
        process.stderr.write(chunk);
        pending += chunk;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) this.onWorkerLog(line.trim());
        if (pending.length > 2000) { this.onWorkerLog(pending.slice(0, 2000)); pending = ""; }
      });
      child.stderr.on("end", () => { if (pending.trim()) this.onWorkerLog(pending.trim()); });
    }
    child.on("error", (error) => { this.errorValue = error.message; });
    child.on("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.childStartedAt = null;
      this.workerMetrics = null;
      this.connection?.socket.destroy();
      this.connection = null;
      this.rejectAll("Video worker stopped before completing this request.");
      if (!this.closing && this.enabled) this.scheduleRestart(`Video worker exited (${signal ?? code ?? "unknown"}).`);
    });
    child.on("message", (message) => {
      if (!message || typeof message !== "object") return;
      const candidate = message as { type?: string; uptimeSeconds?: unknown; memory?: unknown; python?: unknown };
      if (candidate.type === "worker-stats" && typeof candidate.uptimeSeconds === "number" && Number.isFinite(candidate.uptimeSeconds)
        && candidate.memory && typeof candidate.memory === "object" && candidate.python && typeof candidate.python === "object") {
        const memory = candidate.memory as Record<string, unknown>;
        const python = candidate.python as Record<string, unknown>;
        if ([memory.rssBytes, memory.heapUsedBytes, memory.heapTotalBytes].every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)
          && (python.uptimeSeconds === null || (typeof python.uptimeSeconds === "number" && Number.isFinite(python.uptimeSeconds) && python.uptimeSeconds >= 0))
          && (python.rssBytes === null || (typeof python.rssBytes === "number" && Number.isFinite(python.rssBytes) && python.rssBytes >= 0))) {
          this.workerMetrics = {
            uptimeSeconds: candidate.uptimeSeconds,
            memory: { rssBytes: memory.rssBytes as number, heapUsedBytes: memory.heapUsedBytes as number, heapTotalBytes: memory.heapTotalBytes as number },
            python: { uptimeSeconds: python.uptimeSeconds as number | null, rssBytes: python.rssBytes as number | null },
          };
        }
      }
      if (candidate.type === "worker-ready") {
        this.errorValue = null;
      }
    });
    const startupTimeout = setTimeout(() => {
      if (this.child === child && this.stateValue !== "ready") {
        this.errorValue = "Video worker did not connect and initialize within 15 seconds.";
        child.kill();
      }
    }, 15_000);
    child.once("exit", () => clearTimeout(startupTimeout));
  }

  private scheduleRestart(message: string) {
    this.errorValue = message;
    const now = Date.now();
    if (now - this.nextRestartAt > 60_000) this.restartCount = 0;
    if (this.restartCount >= 5) {
      this.stateValue = "failed";
      this.errorValue = `${message} Restart limit reached; restart the Core API after fixing the configuration.`;
      return;
    }
    const delay = Math.min(30_000, 500 * 2 ** this.restartCount);
    this.restartCount += 1;
    this.nextRestartAt = now;
    this.stateValue = "backoff";
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => { this.restartTimer = null; this.launch(); }, delay);
  }

  async request(operation: string, data: Record<string, unknown>, departmentId: string, actor: string, timeoutMs = 15_000): Promise<unknown> {
    if (!this.configured) throw unavailable("The video worker is not configured. Set STREAMING_CONFIG_FILE and map its sites to location IDs.");
    const connection = this.connection;
    if (this.stateValue !== "ready" || !connection || !connection.registered || connection.socket.destroyed) {
      throw unavailable(this.errorValue ?? `Video worker is ${this.stateValue}.`);
    }
    if (this.pending.size >= 8) throw Object.assign(new Error("Video worker is busy. No command was sent."), { code: "BUSY" as const });
    const id = randomBytes(16).toString("hex");
    return new Promise((resolveResult, rejectResult) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectResult(Object.assign(new Error("The video operation timed out. Check device status before trying again."), { code: "TIMEOUT" }));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveResult, reject: rejectResult, timer });
      send(connection.socket, { type: "request", id, operation, data, departmentId, actor });
    });
  }

  private rejectAll(message: string) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(unavailable(message));
    }
    this.pending.clear();
  }

  async close() {
    this.closing = true;
    this.server.off("upgrade", this.onUpgrade);
    this.stop();
    this.rejectAll("The API server is shutting down.");
    this.stateValue = "stopped";
  }
}
