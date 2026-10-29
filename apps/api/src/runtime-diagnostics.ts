export type RuntimeLogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
export type RuntimeLogEntry = { timestamp: string; level: RuntimeLogLevel; source: string; message: string };
export type ManagedWorkerDiagnostics = {
  status: string;
  error: string | null;
  uptimeSeconds: number | null;
  memory: { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number } | null;
  processes?: Array<{ name: string; uptimeSeconds: number | null; rssBytes: number | null }>;
};
export type RuntimeWorkerEntry = ManagedWorkerDiagnostics & { id: string; name: string };

const maxEntries = 150;
const entries: RuntimeLogEntry[] = [];
const workers = new Map<string, { name: string; getDiagnostics: () => ManagedWorkerDiagnostics }>();

export function registerRuntimeWorker(id: string, name: string, getDiagnostics: () => ManagedWorkerDiagnostics) {
  workers.set(id, { name, getDiagnostics });
  return () => { workers.delete(id); };
}

export function runtimeWorkerDiagnostics(): RuntimeWorkerEntry[] {
  return [...workers.entries()].map(([id, worker]) => {
    try { return { id, name: worker.name, ...worker.getDiagnostics() }; }
    catch (error) {
      return { id, name: worker.name, status: "unavailable", error: error instanceof Error ? error.message : "Could not read worker status.", uptimeSeconds: null, memory: null };
    }
  });
}

export function recordRuntimeLog(source: string, level: RuntimeLogLevel, message: string, timestamp = Date.now()) {
  const cleaned = message
    .replace(/\b(password|secret|token|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .trim()
    .slice(0, 600);
  if (!cleaned) return;
  entries.push({ timestamp: new Date(timestamp).toISOString(), level, source: source.slice(0, 40), message: cleaned });
  if (entries.length > maxEntries) entries.splice(0, entries.length - maxEntries);
}

export function recentRuntimeLogs(limit = 100) {
  return entries.slice(-Math.max(1, Math.min(maxEntries, limit))).reverse();
}
