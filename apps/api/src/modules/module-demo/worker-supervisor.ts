import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { ManagedWorkerDiagnostics } from "../../runtime-diagnostics.js";

const workerPath = fileURLToPath(new URL("./worker-entry.js", import.meta.url));
type WorkerStatus = "stopped" | "starting" | "ready" | "backoff" | "failed";
type PendingTime = { resolve: (value: { utc: string; unixMilliseconds: number }) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

export class ModuleDemoWorker {
  private child: ChildProcess | null = null;
  private status: WorkerStatus = "stopped";
  private error: string | null = null;
  private startedAt: number | null = null;
  private memory: { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number } | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private restartCount = 0;
  private closing = false;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private readonly pending = new Map<string, PendingTime>();

  constructor(private readonly onLog: (message: string) => void) {}

  get diagnostics(): ManagedWorkerDiagnostics {
    return {
      status: this.status,
      error: this.error,
      uptimeSeconds: this.child && this.startedAt !== null ? Math.floor((Date.now() - this.startedAt) / 1000) : null,
      memory: this.child ? this.memory : null,
    };
  }

  private launch() {
    if (this.closing || this.child) return;
    this.status = "starting";
    this.error = null;
    this.startedAt = Date.now();
    this.memory = null;
    this.readyPromise = new Promise<void>((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    let child: ChildProcess;
    try {
      child = fork(workerPath, [], { stdio: ["ignore", "ignore", "pipe", "ipc"], execArgv: [], windowsHide: true });
    } catch (reason) {
      this.scheduleRestart(reason instanceof Error ? reason.message : "Could not launch the module worker.");
      return;
    }
    this.child = child;
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      let pending = "";
      child.stderr.on("data", (chunk: string) => {
        pending += chunk;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) this.onLog(line.trim());
        if (pending.length > 2000) { this.onLog(pending.slice(0, 2000)); pending = ""; }
      });
      child.stderr.on("end", () => { if (pending.trim()) this.onLog(pending.trim()); });
    }
    child.on("message", (message: unknown) => this.handleMessage(message));
    child.on("error", (reason) => { this.error = reason.message; this.onLog(`Worker process error: ${reason.message}`); });
    child.on("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.startedAt = null;
      this.memory = null;
      this.rejectPending(new Error("The demo worker stopped before replying."));
      this.readyReject?.(new Error("The demo worker stopped before becoming ready."));
      this.readyPromise = null;
      this.readyResolve = null;
      this.readyReject = null;
      if (!this.closing) this.scheduleRestart(`Demo worker exited (${signal ?? code ?? "unknown"}).`);
      else this.status = "stopped";
    });
    this.startupTimer = setTimeout(() => {
      if (this.child === child && this.status === "starting") {
        this.error = "Demo worker did not start within 5 seconds.";
        child.kill();
      }
    }, 5000);
    this.startupTimer.unref();
  }

  private handleMessage(message: unknown) {
    if (!message || typeof message !== "object") return;
    const candidate = message as { type?: unknown; id?: unknown; utc?: unknown; unixMilliseconds?: unknown; memory?: unknown };
    if (candidate.type === "ready") {
      if (this.startupTimer) clearTimeout(this.startupTimer);
      this.startupTimer = null;
      this.status = "ready";
      this.error = null;
      this.restartCount = 0;
      this.readyResolve?.();
      this.readyResolve = null;
      this.readyReject = null;
      return;
    }
    if (candidate.type === "stats" && candidate.memory && typeof candidate.memory === "object") {
      const memory = candidate.memory as Record<string, unknown>;
      if ([memory.rssBytes, memory.heapUsedBytes, memory.heapTotalBytes].every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)) {
        this.memory = { rssBytes: memory.rssBytes as number, heapUsedBytes: memory.heapUsedBytes as number, heapTotalBytes: memory.heapTotalBytes as number };
      }
      return;
    }
    if (candidate.type === "time" && typeof candidate.id === "string") {
      const pending = this.pending.get(candidate.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(candidate.id);
      if (typeof candidate.utc === "string" && typeof candidate.unixMilliseconds === "number") pending.resolve({ utc: candidate.utc, unixMilliseconds: candidate.unixMilliseconds });
      else pending.reject(new Error("The demo worker returned an invalid time response."));
    }
  }

  private scheduleRestart(message: string) {
    this.error = message;
    this.readyReject?.(new Error(message));
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = null;
    if (this.restartCount >= 5) { this.status = "failed"; return; }
    this.status = "backoff";
    const delay = Math.min(15_000, 500 * 2 ** this.restartCount++);
    this.restartTimer = setTimeout(() => { this.restartTimer = null; this.launch(); }, delay);
    this.restartTimer.unref();
  }

  private async ensureReady() {
    if (this.status === "ready" && this.child) return;
    if (!this.child && !this.closing) this.launch();
    if (!this.readyPromise) throw new Error(this.error ?? `Demo worker is ${this.status}.`);
    await this.readyPromise;
  }

  async getTime() {
    await this.ensureReady();
    const child = this.child;
    if (!child || this.status !== "ready" || !child.connected) throw new Error("Demo worker is not connected.");
    if (this.pending.size >= 8) throw new Error("Demo worker is busy. Try again shortly.");
    const id = randomUUID();
    return new Promise<{ utc: string; unixMilliseconds: number }>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Demo worker did not reply in time.")); }, 3000);
      this.pending.set(id, { resolve, reject, timer });
      child.send({ type: "get-time", id }, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }

  async close() {
    this.closing = true;
    this.status = "stopped";
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.restartTimer = null;
    this.startupTimer = null;
    this.readyReject?.(new Error("The API is shutting down."));
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.rejectPending(new Error("The API is shutting down."));
    const child = this.child;
    this.child = null;
    this.startedAt = null;
    this.memory = null;
    child?.kill();
  }
}
