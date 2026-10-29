export type RuntimeLogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
export type RuntimeLogEntry = { timestamp: string; level: RuntimeLogLevel; source: string; message: string };
export type ManagedWorkerDiagnostics = {
  status: string;
  error: string | null;
  uptimeSeconds: number | null;
  memory: { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number } | null;
  processes?: Array<{ name: string; uptimeSeconds: number | null; rssBytes: number | null }>;
};
export type RuntimeWorkerEntry = ManagedWorkerDiagnostics & { id: string; name: string; restartable: boolean };

const maxEntries = 150;
const entries: RuntimeLogEntry[] = [];
const workers = new Map<string, { name: string; getDiagnostics: () => ManagedWorkerDiagnostics; restart?: () => void | Promise<void> }>();

export function sanitizeDiagnosticText(value: string) {
  return value
    .replace(/\bauthorization\s*[:=]\s*(?:Bearer|Basic)\s+[^\s,;]+/gi, "authorization=[redacted]")
    .replace(/\b(password|secret|token|authorization|cookie|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/([?&](?:token|key|password)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/[\r\n\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, 600);
}

export function registerRuntimeWorker(id: string, name: string, getDiagnostics: () => ManagedWorkerDiagnostics, restart?: () => void | Promise<void>) {
  workers.set(id, { name, getDiagnostics, restart });
  return () => { workers.delete(id); };
}

export function runtimeWorkerDiagnostics(): RuntimeWorkerEntry[] {
  return [...workers.entries()].map(([id, worker]) => {
    try {
      const diagnostics = worker.getDiagnostics();
      return { id, name: worker.name, restartable: Boolean(worker.restart), ...diagnostics, error: diagnostics.error ? sanitizeDiagnosticText(diagnostics.error) : null };
    }
    catch (error) {
      return { id, name: worker.name, restartable: Boolean(worker.restart), status: "unavailable", error: sanitizeDiagnosticText(error instanceof Error ? error.message : "Could not read worker status."), uptimeSeconds: null, memory: null };
    }
  });
}

export async function restartRuntimeWorker(id: string) {
  const worker = workers.get(id);
  if (!worker?.restart) return false;
  await worker.restart();
  return true;
}

export function recordRuntimeLog(source: string, level: RuntimeLogLevel, message: string, timestamp = Date.now()) {
  const cleaned = sanitizeDiagnosticText(message);
  if (!cleaned) return;
  entries.push({ timestamp: new Date(timestamp).toISOString(), level, source: source.slice(0, 40), message: cleaned });
  if (entries.length > maxEntries) entries.splice(0, entries.length - maxEntries);
}

export function recentRuntimeLogs(limit = 100) {
  return entries.slice(-Math.max(1, Math.min(maxEntries, limit))).reverse();
}
