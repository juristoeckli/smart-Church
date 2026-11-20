import { fork, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type Server as NetServer } from "node:net";
import { resolve, join } from "node:path";
import type { ManagedWorkerDiagnostics } from "../runtime-diagnostics.js";

type WorkerState = "stopped" | "starting" | "ready" | "backoff" | "failed";
type ProxyResult = { status: number; contentType: string; body: Buffer };

/** Runs one externally installed module API in a separate Node process. */
export class IsolatedModuleProcess {
  private child: ChildProcess | null = null;
  private state: WorkerState = "stopped";
  private error: string | null = null;
  private startedAt: number | null = null;
  private port = 0;
  private launchGeneration = 0;
  private pendingServer: NetServer | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;
  private restartCount = 0;
  private enabled = false;
  private closing = false;
  private activeRequests = 0;
  private readonly requests = new Set<AbortController>();
  private readonly killTimers = new Map<ChildProcess, NodeJS.Timeout>();
  private readonly token = randomBytes(32).toString("base64url");
  private lastLogAt = 0;
  private suppressedLogs = 0;

  constructor(private readonly id: string, private readonly root: string, private readonly entry: string, private readonly onLog: (message: string) => void) {}

  get diagnostics(): ManagedWorkerDiagnostics {
    return { status: this.state, error: this.error, uptimeSeconds: this.child && this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : null, memory: null };
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.launchGeneration += 1;
      this.pendingServer?.close();
      this.pendingServer = null;
      if (this.restartTimer) clearTimeout(this.restartTimer);
      if (this.stableTimer) clearTimeout(this.stableTimer);
      this.restartTimer = null;
      this.stableTimer = null;
      this.abortRequests();
      if (this.child) this.terminate(this.child);
      this.child = null;
      this.state = "stopped";
      this.startedAt = null;
      this.error = null;
      return;
    }
    this.launch();
  }

  restart() {
    if (this.closing) throw new Error("The module process is shutting down.");
    if (!this.enabled) throw new Error(`Module ${this.id} is disabled.`);
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.restartTimer = null;
    this.stableTimer = null;
    this.launchGeneration += 1;
    this.pendingServer?.close();
    this.pendingServer = null;
    this.restartCount = 0;
    this.abortRequests();
    if (this.child) this.terminate(this.child);
    this.child = null;
    this.launch();
  }

  async proxy(method: string, path: string, body: unknown, departmentId: string, actor: string, grants: string[]): Promise<ProxyResult> {
    if (this.state !== "ready" || !this.child) throw new Error(`Module ${this.id} is not ready.`);
    if (this.activeRequests >= 32) throw new Error(`Module ${this.id} is busy.`);
    if (!actor) throw new Error("A signed-in actor is required for module requests.");
    if (!path.startsWith("/") || path.startsWith("//") || path.length > 8192 || /[\r\n\u0000]/.test(path)) throw new Error("Invalid module request path.");
    const serializedBody = body === undefined ? undefined : JSON.stringify(body);
    if (serializedBody !== undefined && Buffer.byteLength(serializedBody, "utf8") > 1_000_000) throw new Error("Module request exceeds the 1 MB limit.");
    this.activeRequests += 1;
    const controller = new AbortController();
    this.requests.add(controller);
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`http://127.0.0.1:${this.port}${path}`, {
        method,
        signal: controller.signal,
        redirect: "manual",
        headers: { "content-type": "application/json", "x-smart-church-module-token": this.token, "x-smart-church-module-id": this.id, "x-smart-church-module-department": departmentId, "x-smart-church-module-actor": actor, "x-smart-church-module-grants": Buffer.from(JSON.stringify(grants)).toString("base64url") },
        ...(serializedBody === undefined ? {} : { body: serializedBody }),
      });
      if (controller.signal.aborted) throw new Error("Module request was cancelled.");
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new Error("Module redirects are not supported.");
      }
      const reader = response.body?.getReader();
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > 5_000_000) {
            await reader.cancel();
            throw new Error("Module response exceeds the 5 MB limit.");
          }
          chunks.push(Buffer.from(value));
        }
      }
      const bytes = Buffer.concat(chunks, totalBytes);
      const rawContentType = response.headers.get("content-type") ?? "application/json";
      const contentType = /^[\w.+-]+\/[\w.+-]+(?:\s*;\s*[\w=.+-]+)*$/.test(rawContentType) ? rawContentType.slice(0, 160) : "application/octet-stream";
      return { status: response.status, contentType, body: bytes };
    } finally {
      clearTimeout(timer);
      this.requests.delete(controller);
      this.activeRequests -= 1;
    }
  }

  close() {
    this.closing = true;
    this.enabled = false;
    this.launchGeneration += 1;
    this.pendingServer?.close();
    this.pendingServer = null;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.restartTimer = null;
    this.stableTimer = null;
    this.abortRequests();
    if (this.child) this.terminate(this.child);
    this.child = null;
    this.state = "stopped";
  }

  private abortRequests() {
    for (const request of this.requests) request.abort();
    this.requests.clear();
  }

  private launch() {
    if (this.closing || !this.enabled || this.child) return;
    const generation = ++this.launchGeneration;
    this.state = "starting";
    const server = createServer();
    this.pendingServer = server;
    server.once("error", (reason) => {
      if (this.launchGeneration !== generation || this.pendingServer !== server) return;
      this.pendingServer = null;
      this.scheduleRestart(reason.message);
    });
    server.listen(0, "127.0.0.1", () => {
      if (this.launchGeneration !== generation || this.pendingServer !== server) { server.close(); return; }
      const address = server.address();
      this.port = typeof address === "object" && address ? address.port : 0;
      this.pendingServer = null;
      server.close(() => { if (this.launchGeneration === generation) this.forkChild(); });
    });
  }

  private forkChild() {
    if (this.closing || !this.enabled || this.child) return;
    let child: ChildProcess;
    try {
      const dataRoot = process.env.SMART_CHURCH_MODULE_DATA_ROOT ?? "/var/lib/smart-church/module-data";
      child = fork(resolve(this.root, this.entry), [], { cwd: this.root, env: { PATH: process.env.PATH ?? "", ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), NODE_ENV: process.env.NODE_ENV ?? "production", HOST: "127.0.0.1", PORT: String(this.port), SMART_CHURCH_MODULE_ID: this.id, SMART_CHURCH_MODULE_TOKEN: this.token, SMART_CHURCH_MODULE_DATA_DIR: join(dataRoot, this.id) }, stdio: ["ignore", "ignore", "pipe", "ipc"], execArgv: [], windowsHide: true });
    } catch (reason) {
      this.scheduleRestart(reason instanceof Error ? reason.message : "Could not start the module process.");
      return;
    }
    this.child = child;
    this.startedAt = Date.now();
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (line: string) => this.logWorkerOutput(line));
    }
    child.on("error", (reason) => { this.error = reason.message; this.onLog(reason.message); });
    child.once("exit", (code, signal) => {
      const killTimer = this.killTimers.get(child);
      if (killTimer) clearTimeout(killTimer);
      this.killTimers.delete(child);
      if (this.child !== child) return;
      if (this.stableTimer) clearTimeout(this.stableTimer);
      this.stableTimer = null;
      this.abortRequests();
      this.child = null;
      this.startedAt = null;
      if (this.closing || !this.enabled) { this.state = "stopped"; return; }
      this.scheduleRestart(`Module process exited (${signal ?? code ?? "unknown"}).`);
    });
    void this.waitUntilReady(child);
  }

  private async waitUntilReady(child: ChildProcess) {
    const deadline = Date.now() + 10_000;
    while (this.child === child && this.enabled && Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${this.port}/healthz`, { headers: { "x-smart-church-module-token": this.token }, redirect: "manual", signal: AbortSignal.timeout(500) });
        if (response.ok) {
          await response.body?.cancel();
          this.state = "ready";
          this.error = null;
          if (this.stableTimer) clearTimeout(this.stableTimer);
          this.stableTimer = setTimeout(() => { this.stableTimer = null; this.restartCount = 0; }, 60_000);
          this.stableTimer.unref();
          return;
        }
        await response.body?.cancel();
      } catch { /* Wait for the module's local HTTP server to start. */ }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (this.child === child) { this.error = "Module process did not become ready within 10 seconds."; this.terminate(child); }
  }

  private scheduleRestart(message: string) {
    this.error = message;
    this.onLog(message);
    if (!this.enabled || this.closing) { this.state = "stopped"; return; }
    if (this.restartCount >= 5) { this.state = "failed"; return; }
    this.state = "backoff";
    const delay = Math.min(15_000, 500 * 2 ** this.restartCount++);
    this.restartTimer = setTimeout(() => { this.restartTimer = null; this.launch(); }, delay);
    this.restartTimer.unref();
  }

  private logWorkerOutput(output: string) {
    const now = Date.now();
    if (now - this.lastLogAt < 1000) { this.suppressedLogs += 1; return; }
    const suppressed = this.suppressedLogs ? ` (${this.suppressedLogs} log chunks suppressed)` : "";
    this.suppressedLogs = 0;
    this.lastLogAt = now;
    const sanitized = output.replaceAll(this.token, "[redacted]").replace(/\b(password|secret|token|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]").replace(/[\r\n\u0000-\u001f\u007f]+/g, " ");
    this.onLog(`${sanitized.trim().slice(0, 2000)}${suppressed}`);
  }

  private terminate(child: ChildProcess) {
    child.kill("SIGTERM");
    const existing = this.killTimers.get(child);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.killTimers.delete(child);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 2000);
    timer.unref();
    this.killTimers.set(child, timer);
  }
}
