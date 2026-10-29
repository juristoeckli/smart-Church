import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const operations = new Set(["status", "command", "restart-site", "encoder-settings", "videohub-route", "videohub-presets", "videohub-history", "set-device-addresses"]);
const coreUrl = process.env.SMART_CHURCH_CORE_WS_URL;
const token = process.env.SMART_CHURCH_WORKER_TOKEN;
if (!coreUrl || !token) process.exit(1);

const pythonPath = fileURLToPath(new URL("./python/worker.py", import.meta.url));
const stateDirectory = process.env.STREAMING_STATE_DIR || dirname(resolve(process.env.STREAMING_CONFIG_FILE));
try {
  mkdirSync(stateDirectory, { recursive: true });
} catch (error) {
  console.error(`Could not create Video worker state directory: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
}
const pythonCommand = process.env.PYTHON_BINARY || (process.platform === "win32" ? "py" : "python3");
const pythonArgs = [...(process.platform === "win32" && !process.env.PYTHON_BINARY ? ["-3"] : []), "-u", pythonPath];
const python = spawn(pythonCommand, pythonArgs, {
  cwd: stateDirectory,
  windowsHide: true,
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, STREAMING_STATE_DIR: stateDirectory },
});

const pending = new Set();
let pythonReady = false;
let pythonStartedAt = null;
let websocketOpen = false;
let shuttingDown = false;
const socket = new WebSocket(coreUrl);
const lines = createInterface({ input: python.stdout });

python.once("spawn", () => { pythonStartedAt = Date.now(); });

async function reportWorkerStats() {
  const memory = process.memoryUsage();
  let pythonRssBytes = null;
  if (process.platform === "linux" && python.pid) {
    try {
      const status = await readFile(`/proc/${python.pid}/status`, "utf8");
      const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
      if (match) pythonRssBytes = Number(match[1]) * 1024;
    } catch { /* The Python process may not have started or may have exited. */ }
  }
  process.send?.({
    type: "worker-stats",
    uptimeSeconds: process.uptime(),
    memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal },
    python: { uptimeSeconds: pythonStartedAt === null ? null : Math.floor((Date.now() - pythonStartedAt) / 1000), rssBytes: pythonRssBytes },
  });
}
const statsTimer = setInterval(() => { void reportWorkerStats(); }, 10_000);
statsTimer.unref();
void reportWorkerStats();

function stop(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(statsTimer);
  try { socket.close(1001, "worker stopping"); } catch { /* connection already closed */ }
  if (python.exitCode === null && !python.killed) {
    python.kill("SIGTERM");
    const force = setTimeout(() => python.kill("SIGKILL"), 1000);
    force.unref();
  }
  for (const timer of pending) clearTimeout(timer);
  pending.clear();
  setTimeout(() => process.exit(code), 25).unref();
}

function registerWhenReady() {
  if (!websocketOpen || !pythonReady || shuttingDown) return;
  socket.send(JSON.stringify({ type: "register", token }));
}

socket.addEventListener("open", () => {
  websocketOpen = true;
  registerWhenReady();
});
socket.addEventListener("message", (event) => {
  let message;
  try { message = JSON.parse(String(event.data)); }
  catch { return stop(1); }
  if (message?.type === "registered") {
    process.send?.({ type: "worker-ready" });
    return;
  }
  if (message?.type !== "request" || typeof message.id !== "string" || !operations.has(message.operation) ||
      typeof message.departmentId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(message.departmentId) ||
      typeof message.actor !== "string" || !message.data || typeof message.data !== "object" || Array.isArray(message.data)) return stop(1);
  const data = { ...message.data, department_id: message.departmentId, actor: message.actor };
  // The Core supplies the location and actor. Never accept client-provided copies.
  delete data.site;
  if (!python.stdin.writable) {
    socket.send(JSON.stringify({ type: "response", id: message.id, error: "Video worker is shutting down; no command was sent." }));
    return;
  }
  python.stdin.write(`${JSON.stringify({ id: message.id, method: message.operation, data })}\n`);
});
socket.addEventListener("close", () => stop(1));
socket.addEventListener("error", () => stop(1));

lines.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); }
  catch { return stop(1); }
  if (message?.type === "ready") {
    pythonReady = true;
    registerWhenReady();
    return;
  }
  if (typeof message?.id !== "string" || !websocketOpen || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "response", id: message.id, ...(message.error ? { error: message.error } : { result: message.result }) }));
});

python.on("error", (error) => {
  console.error(`Could not start the Video worker Python process: ${error.message}`);
  stop(1);
});
python.on("exit", (code) => { if (!shuttingDown) stop(code ?? 1); });
process.on("SIGTERM", () => stop());
process.on("SIGINT", () => stop());
process.on("disconnect", () => stop());
