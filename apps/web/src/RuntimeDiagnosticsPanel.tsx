import { useCallback, useEffect, useState } from "react";
import { Activity, RefreshCw, Server, Terminal } from "lucide-react";
import "./runtime-diagnostics.css";

type Memory = { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number };
type WorkerDiagnostic = {
  id: string;
  name: string;
  status: string;
  error: string | null;
  uptimeSeconds: number | null;
  memory: Memory | null;
  processes?: Array<{ name: string; uptimeSeconds: number | null; rssBytes: number | null }>;
};
type RuntimeDiagnostics = {
  capturedAt: string;
  runtime: {
    uptimeSeconds: number;
    memory: Memory & { externalBytes: number };
    containerMemory: { usageBytes: number; limitBytes: number | null } | null;
  };
  workers: WorkerDiagnostic[];
  logs: Array<{ timestamp: string; level: string; source: string; message: string }>;
};

function formatBytes(bytes: number | null | undefined) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatUptime(seconds: number | null | undefined) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return days ? `${days}d ${hours}h ${minutes}m` : hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "medium" }).format(date) : value;
}

export function RuntimeDiagnosticsPanel({ departmentId }: { departmentId: string }) {
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/diagnostics", { headers: { "x-department-id": departmentId }, cache: "no-store" });
      const result = await response.json() as RuntimeDiagnostics | { error?: string };
      if (!response.ok || !("runtime" in result)) throw new Error("error" in result ? result.error ?? "Could not load runtime diagnostics." : "Could not load runtime diagnostics.");
      setDiagnostics(result);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load runtime diagnostics.");
    } finally { setLoading(false); }
  }, [departmentId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return <section className="runtime-diagnostics" aria-labelledby="runtime-diagnostics-title">
    <header className="runtime-diagnostics-header">
      <div><span className="runtime-diagnostics-icon"><Activity size={17} /></span><div><h3 id="runtime-diagnostics-title">Runtime diagnostics</h3><p>Process and managed worker usage, uptime, and recent logs.</p></div></div>
      <button className="button button-secondary runtime-refresh" type="button" onClick={() => void refresh()} disabled={loading} aria-label="Refresh diagnostics"><RefreshCw size={14} />Refresh</button>
    </header>
    {error && <p className="runtime-diagnostics-error" role="alert">{error}</p>}
    {loading && !diagnostics ? <p className="runtime-diagnostics-empty">Loading diagnostics…</p> : diagnostics && <>
      <div className="runtime-diagnostics-grid">
        <article className="runtime-diagnostic-card">
          <div className="runtime-diagnostic-title"><Server size={16} /><h4>API container</h4></div>
          <dl><div><dt>Container memory</dt><dd>{diagnostics.runtime.containerMemory ? `${formatBytes(diagnostics.runtime.containerMemory.usageBytes)}${diagnostics.runtime.containerMemory.limitBytes ? ` / ${formatBytes(diagnostics.runtime.containerMemory.limitBytes)}` : ""}` : "Unavailable"}</dd></div><div><dt>API process RSS</dt><dd>{formatBytes(diagnostics.runtime.memory.rssBytes)}</dd></div><div><dt>Heap used / total</dt><dd>{formatBytes(diagnostics.runtime.memory.heapUsedBytes)} / {formatBytes(diagnostics.runtime.memory.heapTotalBytes)}</dd></div><div><dt>Uptime</dt><dd>{formatUptime(diagnostics.runtime.uptimeSeconds)}</dd></div></dl>
        </article>
        {diagnostics.workers.map((worker) => {
          const ready = worker.status === "ready";
          const pending = worker.status === "starting" || worker.status === "backoff";
          return <article className="runtime-diagnostic-card" key={worker.id}>
            <div className="runtime-diagnostic-title"><span className={`runtime-status-dot ${ready ? "runtime-status-ok" : pending ? "runtime-status-pending" : "runtime-status-down"}`} /><h4>{worker.name}</h4><b className={`runtime-worker-state ${ready ? "runtime-text-ok" : pending ? "runtime-text-pending" : "runtime-text-down"}`}>{worker.status}</b></div>
            {worker.error && <p className="runtime-worker-error">{worker.error}</p>}
            <dl><div><dt>Worker memory</dt><dd>{formatBytes(worker.memory?.rssBytes)}</dd></div><div><dt>Heap used / total</dt><dd>{formatBytes(worker.memory?.heapUsedBytes)} / {formatBytes(worker.memory?.heapTotalBytes)}</dd></div><div><dt>Uptime</dt><dd>{formatUptime(worker.uptimeSeconds)}</dd></div>{worker.processes?.map((process) => <div key={process.name}><dt>{process.name} memory / uptime</dt><dd>{formatBytes(process.rssBytes)} / {formatUptime(process.uptimeSeconds)}</dd></div>)}</dl>
          </article>;
        })}
      </div>
      <section className="runtime-log-section" aria-labelledby="runtime-log-title">
        <div className="runtime-log-heading"><div><Terminal size={16} /><h4 id="runtime-log-title">Recent logs</h4></div><small>Most recent {diagnostics.logs.length} · refreshed {formatTime(diagnostics.capturedAt)}</small></div>
        {diagnostics.logs.length ? <ol className="runtime-log-list">{diagnostics.logs.map((entry, index) => <li key={`${entry.timestamp}-${index}`}><time dateTime={entry.timestamp}>{formatTime(entry.timestamp)}</time><span className={`runtime-log-level runtime-log-level-${entry.level}`}>{entry.level}</span><strong>{entry.source}</strong><span className="runtime-log-message">{entry.message}</span></li>)}</ol> : <p className="runtime-diagnostics-empty">No recent logs recorded since the API started.</p>}
        <p className="runtime-log-note">Recent in-memory API and worker logs only; full container logs remain available through Docker.</p>
      </section>
    </>}
  </section>;
}
