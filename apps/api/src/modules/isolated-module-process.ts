import { fork, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
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
  private restartTimer: NodeJS.Timeout | null = null;
  private restartCount = 0;
  private enabled = false;
  private closing = false;
  private activeRequests = 0;
  private readonly requests = new Set<AbortController>();
  private readonly token = randomBytes(32).toString("base64url");

  constructor(private readonly id: string, private readonly root: string, private readonly entry: string, private readonly onLog: (message: string) => void) {}

  get diagnostics(): ManagedWorkerDiagnostics {
    return { status: this.state, error: this.error, uptimeSeconds: this.child && this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : null, memory: null };
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      if (this.restartTimer) clearTimeout(this.restartTimer);
      this.restartTimer = null;
      this.abortRequests();
      this.child?.kill();
      this.child = null;
      this.state = "stopped";
      this.startedAt = null;
      return;
    }
    this.launch();
  }

  restart() {
    if (this.closing) throw new Error("The module process is shutting down.");
    if (!this.enabled) throw new Error(`Module ${this.id} is disabled.`);
    this.restartCount = 0;
    this.abortRequests();
    this.child?.kill();
    this.child = null;
    this.launch();
  }

  async proxy(method: string, path: string, body: unknown, departmentId: string, actor: string, grants: string[]): Promise<ProxyResult> {
    if (this.state !== "ready" || !this.child) throw new Error(`Module ${this.id} is not ready.`);
    if (this.activeRequests >= 32) throw new Error(`Module ${this.id} is busy.`);
    if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Invalid module request path.");
    this.activeRequests += 1;
    const controller = new AbortController();
    this.requests.add(controller);
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`http://127.0.0.1:${this.port}${path}`, {
        method,
        signal: controller.signal,
        headers: { "content-type": "application/json", "x-smart-church-module-token": this.token, "x-smart-church-module-id": this.id, "x-smart-church-module-department": departmentId, "x-smart-church-module-actor": actor, "x-smart-church-module-grants": Buffer.from(JSON.stringify(grants)).toString("base64url") },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
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
      return { status: response.status, contentType: response.headers.get("content-type") ?? "application/json", body: bytes };
    } finally {
      clearTimeout(timer);
      this.requests.delete(controller);
      this.activeRequests -= 1;
    }
  }

  close() {
    this.closing = true;
    this.enabled = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.abortRequests();
    this.child?.kill();
    this.child = null;
    this.state = "stopped";
  }

  private abortRequests() {
    for (const request of this.requests) request.abort();
    this.requests.clear();
  }

  private launch() {
    if (this.closing || !this.enabled || this.child) return;
    this.state = "starting";
    const server = createServer();
    server.once("error", (reason) => this.scheduleRestart(reason.message));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      this.port = typeof address === "object" && address ? address.port : 0;
      server.close(() => this.forkChild());
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
      child.stderr.on("data", (line: string) => this.onLog(line.trim().slice(0, 2000)));
    }
    child.on("error", (reason) => { this.error = reason.message; this.onLog(reason.message); });
    child.once("exit", (code, signal) => {
      if (this.child !== child) return;
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
        const response = await fetch(`http://127.0.0.1:${this.port}/healthz`, { headers: { "x-smart-church-module-token": this.token }, signal: AbortSignal.timeout(500) });
        if (response.ok) { this.state = "ready"; this.error = null; this.restartCount = 0; return; }
      } catch { /* Wait for the module's local HTTP server to start. */ }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (this.child === child) { this.error = "Module process did not become ready within 10 seconds."; child.kill(); }
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
}
