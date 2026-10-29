import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, CircleAlert, Database, RefreshCw, Trash2 } from "lucide-react";

type SyncStatus = {
  configured: boolean;
  instanceUrl?: string;
  enabled: boolean;
  lastSyncAt?: string | null;
  lastSyncError?: string | null;
  peopleCount: number;
  groupCount: number;
  serviceCount: number;
  resourceCount: number;
};

export function SyncModule({ departmentId, settingsPanel = false }: { departmentId: string; settingsPanel?: boolean }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [instanceUrl, setInstanceUrl] = useState("");
  const [loginToken, setLoginToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/modules/sync/churchtools", { headers: { "x-department-id": departmentId } });
      const result = await response.json() as SyncStatus | { error?: string };
      if (!response.ok || !("configured" in result)) throw new Error("error" in result ? result.error ?? "Could not load sync settings." : "Could not load sync settings.");
      setStatus(result);
      setInstanceUrl(result.instanceUrl ?? "");
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load sync settings."); }
  }, [departmentId]);

  useEffect(() => { void load(); }, [load]);

  async function request(path: string, method: string, body?: object) {
    const response = await fetch(path, { method, headers: { "x-department-id": departmentId, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error ?? "The request failed.");
    return result;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback(""); setError("");
    try {
      await request("/api/modules/sync/churchtools", "PUT", { instanceUrl, ...(loginToken.trim() ? { loginToken: loginToken.trim() } : {}) });
      setLoginToken("");
      await request("/api/modules/sync/churchtools/run", "POST");
      setFeedback("ChurchTools connection saved and the first sync is complete."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save ChurchTools settings."); await load(); }
    finally { setBusy(false); }
  }

  async function syncNow() {
    setBusy(true); setFeedback(""); setError("");
    try { await request("/api/modules/sync/churchtools/run", "POST"); setFeedback("ChurchTools data synced."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Sync failed."); await load(); }
    finally { setBusy(false); }
  }

  async function toggle() {
    if (!status) return;
    setBusy(true); setError(""); setFeedback("");
    try { await request("/api/modules/sync/churchtools", "PATCH", { enabled: !status.enabled }); setFeedback(status.enabled ? "Sync paused. Imported data is still available." : "Sync enabled."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update sync settings."); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!window.confirm("Remove ChurchTools sync and permanently delete all people, groups, services, and resources imported by this sync? Bookings attached to imported resources will also be removed.")) return;
    setBusy(true); setError(""); setFeedback("");
    try { await request("/api/modules/sync/churchtools", "DELETE"); setLoginToken(""); setFeedback("Sync settings and imported data removed."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not remove imported data."); }
    finally { setBusy(false); }
  }

  const totalImported = (status?.peopleCount ?? 0) + (status?.groupCount ?? 0) + (status?.serviceCount ?? 0) + (status?.resourceCount ?? 0);
  return <div className={settingsPanel ? "sync-settings-panel-view" : undefined}>
    <div className={`demo-notice ${error || status?.lastSyncError ? "demo-notice-error" : ""}`}><span className="demo-dot" />{error || status?.lastSyncError || "ChurchTools data is imported as read-only records."}</div>
    {!settingsPanel && <section className="page-heading"><div><div className="eyebrow">INTEGRATIONS</div><h1>ChurchTools sync</h1><p className="page-subtitle">Bring people, groups and their members, services, and bookable resources into this site. Imported records follow ChurchTools and cannot be edited here.</p></div>{status?.configured && <button className="button button-primary" type="button" onClick={() => void syncNow()} disabled={busy || !status.enabled}><RefreshCw size={16} />{busy ? "Working…" : "Sync now"}</button>}</section>}
    <section className="sync-summary-grid" aria-label="Imported data summary">
      {[ ["People", status?.peopleCount ?? 0], ["Groups", status?.groupCount ?? 0], ["Services & events", status?.serviceCount ?? 0], ["Resources", status?.resourceCount ?? 0] ].map(([label, count]) => <article className="stat-card" key={label}><div className="stat-icon stat-icon-blue"><Database size={18} /></div><div className="stat-content"><span>{label}</span><strong>{count}</strong><small>Imported from ChurchTools</small></div></article>)}
    </section>
    <section className="directory-card sync-settings-card">
      <div className="directory-heading"><div><h2>Connection</h2><p>{status?.configured ? `Last sync: ${status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : "Not yet synced"}` : "Connect a ChurchTools cloud site using a Login token."}</p></div><div className="community-inline-actions">{status?.configured && <span className={`event-kind ${status.enabled ? "event-kind-service" : "event-kind-other"}`}>{status.enabled ? "Enabled" : "Paused"}</span>}{settingsPanel && status?.configured && <button className="button button-primary" type="button" onClick={() => void syncNow()} disabled={busy || !status.enabled}><RefreshCw size={15} />{busy ? "Working…" : "Sync now"}</button>}</div></div>
      <form className="sync-connection-form" onSubmit={save}>
        <label>ChurchTools site URL<input type="url" required placeholder="https://my-church.church.tools" value={instanceUrl} onChange={(event) => setInstanceUrl(event.target.value)} /></label>
        <label>ChurchTools Login token<input type="password" autoComplete="new-password" placeholder={status?.configured ? "Leave blank to keep the saved token" : "Paste a Login token"} value={loginToken} onChange={(event) => setLoginToken(event.target.value)} /></label>
        <p className="sync-help">Create a Login token in ChurchTools API settings with read access to people, groups and group memberships, events, and resources. The token is stored encrypted on the server and is never sent back to this screen.</p>
        <div className="form-actions"><button className="button button-primary" type="submit" disabled={busy || (!loginToken.trim() && !status?.configured)}><Check size={15} />{busy ? "Verifying…" : "Save and verify"}</button></div>
      </form>
      {feedback && <p className="sync-feedback" role="status"><Check size={15} />{feedback}</p>}
      {status?.lastSyncError && <p className="sync-feedback sync-feedback-error" role="alert"><CircleAlert size={15} />Last sync failed: {status.lastSyncError}</p>}
    </section>
    {status?.configured && <section className="directory-card sync-controls-card"><div><h2>Module controls</h2><p>Pause scheduled sync and keep the imported records, or remove the connection and delete its imported records from this site.</p></div><div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void toggle()} disabled={busy}>{status.enabled ? "Pause sync" : "Enable sync"}</button><button className="button button-danger" type="button" onClick={() => void remove()} disabled={busy || totalImported === 0 && !status.configured}><Trash2 size={14} />Remove sync and imported data</button></div></section>}
    <footer className="page-footer"><span>Automatically syncs every 15 minutes while enabled.</span><span>Only site administrators can manage this connection.</span></footer>
  </div>;
}
