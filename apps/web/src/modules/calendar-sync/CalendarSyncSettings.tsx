import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Check, Copy, Link2, RefreshCw, Trash2, Unplug } from "lucide-react";

const eventKinds = [
  { id: "service", label: "Services" },
  { id: "meeting", label: "Meetings" },
  { id: "community", label: "Community events" },
  { id: "other", label: "Other events" },
] as const;
type EventKind = typeof eventKinds[number]["id"];
type Provider = "google" | "microsoft";
type CalendarOption = { id: string; name: string };
type Connection = {
  id: string;
  provider: Provider;
  accountEmail: string;
  calendarId: string;
  calendarName: string;
  eventKinds: EventKind[];
  lastSyncAt: string | null;
  lastSyncError: string | null;
};
type Status = {
  configured: { google?: boolean; microsoft?: boolean };
  eventKinds: EventKind[];
  feedUrl: string | null;
  connections: Connection[];
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(body.error ?? "Calendar Sync could not complete the request.");
  return body;
}

function ProviderIcon({ provider }: { provider: Provider }) {
  return <span className={`calendar-sync-provider-icon calendar-sync-provider-${provider}`} aria-hidden="true">{provider === "google" ? "G" : "M"}</span>;
}

function EventKindPicker({ value, onChange, disabled, label }: { value: EventKind[]; onChange: (value: EventKind[]) => void; disabled?: boolean; label: string }) {
  return <fieldset className="calendar-sync-kinds" disabled={disabled}>
    <legend>{label}</legend>
    {eventKinds.map((kind) => <label key={kind.id}>
      <input type="checkbox" checked={value.includes(kind.id)} onChange={(event) => onChange(event.target.checked ? [...new Set([...value, kind.id])] : value.filter((item) => item !== kind.id))} />
      <span>{kind.label}</span>
    </label>)}
  </fieldset>;
}

export function CalendarSyncSettings({ departmentId, csrfToken }: { departmentId: string; csrfToken: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [feedDraft, setFeedDraft] = useState<EventKind[]>([]);
  const [calendarOptions, setCalendarOptions] = useState<Record<string, CalendarOption[]>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);

  const headers = { "x-department-id": departmentId };
  const mutationHeaders = { ...headers, "x-csrf-token": csrfToken, "content-type": "application/json" };

  const load = useCallback(async () => {
    try {
      const result = await api<Status>("/api/modules/calendar-sync/status", { headers });
      setStatus(result);
      setFeedDraft(result.eventKinds ?? []);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load calendar sync settings.");
    }
  }, [departmentId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("calendarSync");
    if (result === "connected") setNotice("Calendar connected. Smart Church will begin syncing your selected events shortly.");
    else if (result === "expired") setError("The calendar authorization expired before it could finish. Try connecting again.");
    else if (result === "failed") setError("The calendar provider could not connect. Check your account permissions and try again.");
    if (result) {
      const url = new URL(window.location.href);
      url.searchParams.delete("calendarSync");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  async function run(key: string, action: () => Promise<void>, success?: string) {
    setBusy(key); setError(""); setNotice("");
    try { await action(); if (success) setNotice(success); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Calendar Sync could not complete the request."); }
    finally { setBusy(""); }
  }

  async function saveFeedKinds(value: EventKind[]) {
    setFeedDraft(value);
    await run("preferences", async () => {
      await api("/api/modules/calendar-sync/preferences", { method: "PUT", headers: mutationHeaders, body: JSON.stringify({ eventKinds: value }) });
    }, "Feed filters saved.");
  }

  async function createFeed() {
    await run("feed", async () => {
      const result = await api<{ feedUrl: string }>("/api/modules/calendar-sync/feed", { method: "POST", headers: mutationHeaders });
      setStatus((current) => current ? { ...current, feedUrl: result.feedUrl } : current);
    }, "Private calendar link created.");
  }

  async function revokeFeed() {
    if (!window.confirm("Revoke this private calendar link? Apps using it will stop receiving updates.")) return;
    await run("feed", async () => {
      await api("/api/modules/calendar-sync/feed", { method: "DELETE", headers: mutationHeaders });
      setStatus((current) => current ? { ...current, feedUrl: null } : current);
    }, "Private calendar link revoked.");
  }

  async function copyFeed() {
    if (!status?.feedUrl) return;
    try { await navigator.clipboard.writeText(status.feedUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setError("Could not copy the link. Select and copy it manually."); }
  }

  async function connect(provider: Provider) {
    await run(`oauth-${provider}`, async () => {
      const result = await api<{ url: string }>(`/api/modules/calendar-sync/oauth/${provider}/start`, { method: "POST", headers: mutationHeaders });
      window.location.assign(result.url);
    });
  }

  async function loadCalendars(provider: Provider) {
    try {
      const result = await api<{ calendars: CalendarOption[] }>(`/api/modules/calendar-sync/calendars/${provider}`, { headers });
      setCalendarOptions((current) => ({ ...current, [provider]: result.calendars }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load calendars."); }
  }

  async function updateConnection(connection: Connection, patch: Partial<Pick<Connection, "calendarId" | "eventKinds">>) {
    await run(`connection-${connection.id}`, async () => {
      await api(`/api/modules/calendar-sync/connections/${connection.id}`, { method: "PUT", headers: mutationHeaders, body: JSON.stringify(patch) });
    }, "Calendar sync settings saved.");
  }

  async function disconnect(connection: Connection) {
    if (!window.confirm(`Disconnect ${connection.accountEmail || connection.calendarName}? Events synced by Smart Church will be removed from that calendar.`)) return;
    await run(`connection-${connection.id}`, async () => {
      await api(`/api/modules/calendar-sync/connections/${connection.id}`, { method: "DELETE", headers: mutationHeaders });
    }, "Calendar disconnected.");
  }

  if (!status && !error) return <section className="calendar-sync-page" role="status">Loading Calendar Sync…</section>;

  return <div className="calendar-sync-page">
    <header className="calendar-sync-header">
      <span className="calendar-sync-heading-icon"><CalendarDays size={21} /></span>
      <div><h2>Calendar sync</h2><p>Share selected Smart Church events in your personal calendar or subscribe by calendar link.</p></div>
      <button className="button button-secondary" type="button" onClick={() => void load()} disabled={!!busy} aria-label="Refresh calendar sync"><RefreshCw size={15} />Refresh</button>
    </header>
    {error && <p className="calendar-sync-alert" role="alert">{error}</p>}
    {notice && <p className="calendar-sync-notice" role="status">{notice}</p>}

    <section className="calendar-sync-card">
      <div className="calendar-sync-card-heading"><div><h3>Private iCalendar feed</h3><p>Subscribe from any calendar app that supports iCalendar. The link is private and stays active until you revoke it.</p></div><Link2 size={18} /></div>
      <EventKindPicker value={feedDraft} label="Events to include" disabled={busy === "preferences"} onChange={(value) => void saveFeedKinds(value)} />
      {status?.feedUrl ? <div className="calendar-sync-feed-row"><input aria-label="Private iCalendar feed URL" readOnly value={status.feedUrl} onFocus={(event) => event.currentTarget.select()} /><button className="button button-secondary" type="button" onClick={() => void copyFeed()}><Copy size={14} />{copied ? "Copied" : "Copy link"}</button><button className="button button-danger" type="button" onClick={() => void revokeFeed()} disabled={!!busy}><Trash2 size={14} />Revoke</button></div>
        : <button className="button button-primary" type="button" onClick={() => void createFeed()} disabled={!!busy || feedDraft.length === 0}>{busy === "feed" ? "Creating…" : "Create private calendar link"}</button>}
    </section>

    <section className="calendar-sync-card">
      <div className="calendar-sync-card-heading"><div><h3>Connect a calendar</h3><p>Choose your Google or Microsoft account. Smart Church will create and update matching event entries in its calendar.</p></div></div>
      <div className="calendar-sync-providers">
        {(["google", "microsoft"] as const).map((provider) => {
          const label = provider === "google" ? "Google Calendar" : "Microsoft Outlook / 365";
          const connected = status?.connections.some((item) => item.provider === provider);
          const configured = status?.configured?.[provider] !== false;
          return <article className="calendar-sync-provider-card" key={provider}>
            <div className="calendar-sync-provider-title"><ProviderIcon provider={provider} /><strong>{label}</strong></div>
            {connected ? <span className="calendar-sync-connected"><Check size={13} />Connected</span> : <button className="button button-secondary" type="button" disabled={!!busy || !configured} onClick={() => void connect(provider)}>{busy === `oauth-${provider}` ? "Connecting…" : `Connect ${provider === "google" ? "Google" : "Microsoft"}`}</button>}
            {!configured && <small className="calendar-sync-help">This provider is not configured on this Smart Church server.</small>}
          </article>;
        })}
      </div>
      {status?.connections.map((connection) => <article className="calendar-sync-connection" key={connection.id}>
        <div className="calendar-sync-connection-top"><div className="calendar-sync-provider-title"><ProviderIcon provider={connection.provider} /><span><strong>{connection.accountEmail || (connection.provider === "google" ? "Google account" : "Microsoft account")}</strong><small>{connection.calendarName}</small></span></div><button className="button button-danger" type="button" onClick={() => void disconnect(connection)} disabled={!!busy}><Unplug size={14} />Disconnect</button></div>
        <div className="calendar-sync-connection-controls">
          <label className="calendar-sync-select">Destination calendar<select value={connection.calendarId} disabled={!!busy} onFocus={() => { if (!calendarOptions[connection.provider]) void loadCalendars(connection.provider); }} onChange={(event) => void updateConnection(connection, { calendarId: event.target.value })}><option value={connection.calendarId}>{connection.calendarName}</option>{(calendarOptions[connection.provider] ?? []).filter((calendar) => calendar.id !== connection.calendarId).map((calendar) => <option value={calendar.id} key={calendar.id}>{calendar.name}</option>)}</select></label>
          <EventKindPicker value={connection.eventKinds ?? []} label="Events to sync" disabled={!!busy} onChange={(value) => void updateConnection(connection, { eventKinds: value })} />
        </div>
        <div className="calendar-sync-sync-state">{connection.lastSyncError ? <span className="calendar-sync-error">Sync issue: {connection.lastSyncError}</span> : <span>{connection.lastSyncAt ? `Last synced ${new Date(connection.lastSyncAt).toLocaleString()}` : "Waiting for first sync"}</span>}</div>
      </article>)}
    </section>
    <p className="calendar-sync-footnote">Calendar entries are one-way copies from Smart Church. Changes made in Google or Outlook are not copied back.</p>
  </div>;
}
