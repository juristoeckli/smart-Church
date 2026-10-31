import { open } from "node:fs/promises";

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

const maxEntries = 1_000;
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

export function recentRuntimeLogs(limit = 500) {
  return entries.slice(-Math.max(1, Math.min(maxEntries, limit))).reverse();
}

export function followRuntimeLogFile(source: string, filePath: string | undefined, pollIntervalMs = 1000) {
  const path = filePath?.trim();
  if (!path) return () => {};

  let offset = 0;
  let fileIdentity = "";
  let partialLine = "";
  let stopped = false;
  let polling = false;

  const poll = async () => {
    if (stopped || polling) return;
    polling = true;
    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
      file = await open(path, "r");
      const metadata = await file.stat();
      const nextIdentity = `${metadata.dev}:${metadata.ino}`;
      if (metadata.size < offset || (fileIdentity && fileIdentity !== nextIdentity)) {
        offset = 0;
        partialLine = "";
      }
      fileIdentity = nextIdentity;

      const maxReadBytes = 128 * 1024;
      if (metadata.size - offset > maxReadBytes) {
        offset = metadata.size - maxReadBytes;
        partialLine = "";
      }
      const length = metadata.size - offset;
      if (length <= 0) return;

      const buffer = Buffer.alloc(length);
      const { bytesRead } = await file.read(buffer, 0, length, offset);
      offset += bytesRead;
      const lines = `${partialLine}${buffer.toString("utf8", 0, bytesRead)}`.split(/\r?\n/);
      partialLine = lines.pop() ?? "";
      if (partialLine.length > 2048) partialLine = partialLine.slice(-2048);

      for (const rawLine of lines.slice(-250)) {
        const line = rawLine.replace(/^\s*guacd(?:\[\d+\])?:\s*/i, "").trim();
        if (!line) continue;
        const match = line.match(/^(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL):\s*(.*)$/i);
        const levelName = match?.[1]?.toLowerCase() ?? "info";
        const level: RuntimeLogLevel = levelName === "warning" ? "warn" : levelName as RuntimeLogLevel;
        const message = (match?.[2] ?? line)
          .replace(/\b(password|secret|token|authorization|cookie|api[_-]?key|username|user)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
          .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]");
        recordRuntimeLog(source, level, message);
      }
    } catch {
      // The optional log volume may be absent until the remote desktop stack starts.
    } finally {
      await file?.close().catch(() => {});
      polling = false;
    }
  };

  void poll();
  const timer = setInterval(() => { void poll(); }, Math.max(250, pollIntervalMs));
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
