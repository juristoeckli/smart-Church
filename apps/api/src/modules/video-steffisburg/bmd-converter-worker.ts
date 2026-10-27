import { randomUUID } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

type WorkerReply = { type?: string; id?: string; result?: unknown; error?: string };
type PendingReply = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

const workerPath = fileURLToPath(new URL("./bmd-converter-worker.js", import.meta.url));

export class BmdConverterWorker {
  private child: ChildProcess | null = null;
  private readonly pending = new Map<string, PendingReply>();
  private restartTimer: NodeJS.Timeout | null = null;
  private restartCount = 0;
  private closing = false;
  private stateValue: "unconfigured" | "starting" | "ready" | "backoff" | "failed" | "stopped";
  private errorValue: string | null = null;
  private readonly host: string;
  private readonly port: string;
  readonly configured: boolean;

  constructor(host = process.env.BMD_CONVERTER_DS700_HOST?.trim() ?? "", port = process.env.BMD_CONVERTER_DS700_PORT || "19540") {
    this.host = host;
    this.port = port;
    this.configured = Boolean(host);
    this.stateValue = this.configured ? "starting" : "unconfigured";
  }

  get state() { return { state: this.stateValue, error: this.errorValue }; }

  start() {
    if (this.configured) this.launch();
  }

  private launch() {
    if (this.closing || this.child || !this.configured) return;
    this.stateValue = "starting";
    let child: ChildProcess;
    try {
      child = fork(workerPath, [], {
        cwd: process.cwd(),
        env: { ...process.env, BMD_CONVERTER_DS700_HOST: this.host, BMD_CONVERTER_DS700_PORT: this.port },
        stdio: ["ignore", "inherit", "inherit", "ipc"],
        execArgv: [],
        windowsHide: true,
      });
    } catch (error) {
      this.scheduleRestart(`Could not start the DS-700 worker: ${error instanceof Error ? error.message : "process creation failed"}.`);
      return;
    }
    this.child = child;
    child.on("message", (message: WorkerReply) => {
      if (message?.type === "worker-ready") {
        this.stateValue = "ready";
        this.errorValue = null;
        this.restartCount = 0;
        return;
      }
      if (message?.type !== "response" || typeof message.id !== "string") return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (typeof message.error === "string") pending.reject(new Error(message.error));
      else pending.resolve(message.result);
    });
    child.on("error", (error) => { this.errorValue = error.message; });
    child.on("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.rejectPending("DS-700 worker stopped before completing discovery.");
      if (!this.closing) this.scheduleRestart(`DS-700 worker exited (${signal ?? code ?? "unknown"}).`);
    });
    const startupTimeout = setTimeout(() => {
      if (this.child === child && this.stateValue !== "ready") {
        this.errorValue = "DS-700 worker did not initialize within 5 seconds.";
        child.kill();
      }
    }, 5_000);
    child.once("exit", () => clearTimeout(startupTimeout));
  }

  private scheduleRestart(message: string) {
    this.errorValue = message;
    if (this.restartCount >= 5) {
      this.stateValue = "failed";
      this.errorValue = `${message} Restart limit reached.`;
      return;
    }
    this.stateValue = "backoff";
    const delay = Math.min(30_000, 500 * 2 ** this.restartCount++);
    this.restartTimer = setTimeout(() => { this.restartTimer = null; this.launch(); }, delay);
  }

  private async request(operation: "discover" | "read-aes-level" | "set-aes-level" | "read-audio-levels" | "set-analog-levels", timeoutMs: number, converterId: string, value?: number | number[]): Promise<unknown> {
    if (!this.configured) return { configured: false };
    const readyDeadline = Date.now() + Math.min(timeoutMs, 5_000);
    while (this.stateValue === "starting" || this.stateValue === "backoff") {
      if (Date.now() >= readyDeadline) throw new Error("The Silex converter worker did not become ready in time.");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const child = this.child;
    if (this.stateValue !== "ready" || !child?.connected) throw new Error(this.errorValue ?? `DS-700 worker is ${this.stateValue}.`);
    if (this.pending.size >= 4) throw new Error("DS-700 worker is busy; no discovery request was sent.");
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The DS-700 worker did not complete ${operation} in time.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.send({ id, operation, converterId, ...(value === undefined ? {} : Array.isArray(value) ? { levels: value } : { level: value }) }, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  discover(converterId: string): Promise<unknown> { return this.request("discover", 40_000, converterId); }
  readAesLevel(converterId: string): Promise<unknown> { return this.request("read-aes-level", 45_000, converterId); }
  setAesLevel(level: number, converterId: string): Promise<unknown> { return this.request("set-aes-level", 45_000, converterId, level); }
  readAudioLevels(converterId: string): Promise<unknown> { return this.request("read-audio-levels", 60_000, converterId); }
  setAnalogLevels(levels: number[], converterId: string): Promise<unknown> { return this.request("set-analog-levels", 90_000, converterId, levels); }

  private rejectPending(message: string) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }

  async close() {
    this.closing = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.rejectPending("API is shutting down.");
    this.child?.disconnect();
    this.child?.kill();
    this.child = null;
    this.stateValue = "stopped";
  }
}
