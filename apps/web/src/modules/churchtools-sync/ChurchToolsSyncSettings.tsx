import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, CircleAlert, Database, RefreshCw, Trash2 } from "lucide-react";
import { formatUserDate } from "../../date-format";
import { getActiveLanguage } from "../../i18n";
import { translateModuleMessage } from "../translations";
import { BookingHistory } from "./BookingHistory";
import { CalendarSeriesImport } from "./CalendarSeriesImport";
import { ArrangementMediaReview } from "./ArrangementMediaReview";
import { ServiceTemplateImport } from "./ServiceTemplateImport";
import { MembershipDetails } from "./MembershipDetails";
import { FinancePreview } from "./FinancePreview";
import "../sync/federation.css";

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
  migration?: { page: number; total: number; created: number; updated: number; skipped: number; failed?: number; failedRecords?: Array<{ area: string; sourceId: string }>; complete: boolean; previewAt: string; startDate: string; endDate: string } | null;
};
type ChurchToolsMigrationPreview = { complete: boolean; total: number; create: number; update: number; review: number; invalid: number; unmappedFields: number; startDate: string; endDate: string; bookingHistory?: { series: number; occurrences: number; anonymized: number } | null; songCatalog?: { songs: number; arrangements: number; conflicts: number } | null; eventAgendas?: { available: number; missing: number; forbidden: number; skipped: number; songSelections: number } | null; groupMemberships?: { members: number; concealed: number; unknownRoles: number; withRestrictedDetails: number; eligibleCustomFields: number; excludedCustomFields: number } | null; sample: Array<{ area: string; name: string; email?: string | null; date?: string; action: string; relationshipsCount?: number; unmappedFields?: string[] }> };

function shiftUtcYear(years: number) {
  const date = new Date(); date.setUTCFullYear(date.getUTCFullYear() + years); return date.toISOString().slice(0, 10);
}

export function SyncModule({ departmentId, csrfToken, settingsPanel = false }: { departmentId: string; csrfToken: string; settingsPanel?: boolean }) {
  const t = (message: string) => translateModuleMessage("sync", getActiveLanguage(), message);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [instanceUrl, setInstanceUrl] = useState("");
  const [loginToken, setLoginToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [migrationStartDate, setMigrationStartDate] = useState(() => shiftUtcYear(-5));
  const [migrationEndDate, setMigrationEndDate] = useState(() => shiftUtcYear(5));
  const [migrationPreview, setMigrationPreview] = useState<ChurchToolsMigrationPreview | null>(null);
  const [includeBookingHistory, setIncludeBookingHistory] = useState(false);
  const [includeSongCatalog, setIncludeSongCatalog] = useState(false);
  const [includeEventAgendas, setIncludeEventAgendas] = useState(false);
  const [includeMembershipDetails, setIncludeMembershipDetails] = useState(false);
  const [includeMembershipCustomFields, setIncludeMembershipCustomFields] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/modules/sync/churchtools", { headers: { "x-department-id": departmentId } });
      const result = await response.json() as SyncStatus | { error?: string };
      if (!response.ok || !("configured" in result)) throw new Error("error" in result ? result.error ?? t("Could not load sync settings.") : t("Could not load sync settings."));
      setStatus(result);
      setInstanceUrl(result.instanceUrl ?? "");
      setError("");
    } catch (reason) { setError(reason instanceof Error ? t(reason.message) : t("Could not load sync settings.")); }
  }, [departmentId]);

  useEffect(() => { void load(); }, [load]);

  async function request(path: string, method: string, body?: object) {
    const response = await fetch(path, { method, headers: { "x-department-id": departmentId, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error ? t(result.error) : t("The request failed."));
    return result;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback(""); setError("");
    try {
      await request("/api/modules/sync/churchtools", "PUT", { instanceUrl, ...(loginToken.trim() ? { loginToken: loginToken.trim() } : {}) });
      setLoginToken("");
      await request("/api/modules/sync/churchtools/run", "POST");
      setFeedback(t("ChurchTools connection saved and the first sync is complete.")); await load();
    } catch (reason) { setError(reason instanceof Error ? t(reason.message) : t("Could not save ChurchTools settings.")); await load(); }
    finally { setBusy(false); }
  }

  async function syncNow() {
    setBusy(true); setFeedback(""); setError("");
    try { await request("/api/modules/sync/churchtools/run", "POST"); setFeedback(t("ChurchTools data synced.")); await load(); }
    catch (reason) { setError(reason instanceof Error ? t(reason.message) : t("Sync failed.")); await load(); }
    finally { setBusy(false); }
  }

  async function previewMigration() {
    setBusy(true); setFeedback(""); setError(""); setMigrationPreview(null);
    try {
      const result = await request("/api/modules/sync/churchtools/migration-preview", "POST", { startDate: migrationStartDate, endDate: migrationEndDate, includeBookingHistory, includeSongCatalog, includeEventAgendas, includeMembershipDetails, includeMembershipCustomFields }) as unknown as ChurchToolsMigrationPreview;
      if (!result.complete || !Array.isArray(result.sample)) throw new Error(t("ChurchTools did not return a complete migration preview."));
      setMigrationPreview(result); await load();
    } catch (reason) { setError(reason instanceof Error ? t(reason.message) : t("Could not preview the ChurchTools migration.")); }
    finally { setBusy(false); }
  }

  async function importMigration(restart = false) {
    if (!status?.migration?.previewAt) return;
    setBusy(true); setFeedback(""); setError("");
    try {
      const result = await request("/api/modules/sync/churchtools/migration", "POST", restart ? { restart: true } : undefined) as unknown as { migration?: NonNullable<SyncStatus["migration"]> };
      if (!result.migration) throw new Error(t("ChurchTools did not return migration progress."));
      await load(); setFeedback(t(result.migration.complete ? "ChurchTools migration is complete." : "Migration batch complete. Continue to resume."));
    } catch (reason) { setError(reason instanceof Error ? t(reason.message) : t("Could not import the ChurchTools migration batch.")); await load(); }
    finally { setBusy(false); }
  }

  async function toggle() {
    if (!status) return;
    setBusy(true); setError(""); setFeedback("");
    try { await request("/api/modules/sync/churchtools", "PATCH", { enabled: !status.enabled }); setFeedback(t(status.enabled ? "Sync paused. Imported data is still available." : "Sync enabled.")); await load(); }
    catch (reason) { setError(reason instanceof Error ? t(reason.message) : t("Could not update sync settings.")); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!window.confirm(t("Remove ChurchTools sync and permanently delete all people, groups, services, and resources imported by this sync? Bookings attached to imported resources will also be removed."))) return;
    setBusy(true); setError(""); setFeedback("");
    try { await request("/api/modules/sync/churchtools", "DELETE"); setLoginToken(""); setFeedback(t("Sync settings and imported data removed.")); await load(); }
    catch (reason) { setError(reason instanceof Error ? t(reason.message) : t("Could not remove imported data.")); }
    finally { setBusy(false); }
  }

  const totalImported = (status?.peopleCount ?? 0) + (status?.groupCount ?? 0) + (status?.serviceCount ?? 0) + (status?.resourceCount ?? 0);
  return <div className={settingsPanel ? "sync-settings-panel-view" : undefined}>
    {!settingsPanel && <section className="page-heading"><div><div className="eyebrow">{t("INTEGRATIONS")}</div><h1>{t("ChurchTools Sync")}</h1><p className="page-subtitle">{t("Manage the ChurchTools connection for this location.")}</p></div></section>}
    <div className={`demo-notice ${error || status?.lastSyncError ? "demo-notice-error" : ""}`}><span className="demo-dot" />{error || (status?.lastSyncError ? t(status.lastSyncError) : t("ChurchTools data is imported as read-only records."))}</div>
    <section className="sync-summary-grid" aria-label={t("Imported data summary")}>
      {[ ["People", status?.peopleCount ?? 0], ["Groups", status?.groupCount ?? 0], ["Services & events", status?.serviceCount ?? 0], ["Resources", status?.resourceCount ?? 0] ].map(([label, count]) => <article className="stat-card" key={label}><div className="stat-icon stat-icon-blue"><Database size={18} /></div><div className="stat-content"><span>{t(String(label))}</span><strong>{count}</strong><small>{t("Imported from ChurchTools")}</small></div></article>)}
    </section>
    <section className="directory-card sync-settings-card">
      <div className="directory-heading"><div><h2>{t("Connection")}</h2><p>{status?.configured ? `${t("Last sync:")} ${status.lastSyncAt ? formatUserDate(status.lastSyncAt, true) : t("Not yet synced")}` : t("Connect a ChurchTools cloud site using a Login token.")}</p></div><div className="community-inline-actions">{status?.configured && <span className={`event-kind ${status.enabled ? "event-kind-service" : "event-kind-other"}`}>{status.enabled ? t("Enabled") : t("Paused")}</span>}{settingsPanel && status?.configured && <button className="button button-primary" type="button" onClick={() => void syncNow()} disabled={busy || !status.enabled}><RefreshCw size={15} />{busy ? t("Working…") : t("Sync now")}</button>}</div></div>
      <form className="sync-connection-form" onSubmit={save}>
        <label>{t("ChurchTools site URL")}<input type="url" required placeholder="https://my-church.church.tools" value={instanceUrl} onChange={(event) => setInstanceUrl(event.target.value)} /></label>
        <label>{t("ChurchTools Login token")}<input type="password" autoComplete="new-password" placeholder={status?.configured ? t("Leave blank to keep the saved token") : t("Paste a Login token")} value={loginToken} onChange={(event) => setLoginToken(event.target.value)} /></label>
        <p className="sync-help">{t("Create a Login token in ChurchTools API settings with read access to people, groups and group memberships, events, and resources. The token is stored encrypted on the server and is never sent back to this screen.")}</p>
        <div className="form-actions"><button className="button button-primary" type="submit" disabled={busy || (!loginToken.trim() && !status?.configured)}><Check size={15} />{busy ? t("Verifying…") : t("Save and verify")}</button></div>
      </form>
      {feedback && <p className="sync-feedback" role="status"><Check size={15} />{feedback}</p>}
      {status?.lastSyncError && <p className="sync-feedback sync-feedback-error" role="alert"><CircleAlert size={15} />{t("Last sync failed:")} {t(status.lastSyncError)}</p>}
    </section>
    {settingsPanel && status?.configured && <section className="directory-card sync-settings-card">
      <div className="directory-heading"><div><h2>{t("One-time ChurchTools migration")}</h2><p>{t("Preview and import people, groups, services/events, and resources into this location. Imported records stay editable and are not tied to scheduled sync.")}</p></div></div>
      <p className="sync-help">{t("Matching uses stable ChurchTools IDs. Email, name, and event matches are flagged for review instead of merged. Group import adds linked members and keeps local memberships. Person fields and relationship records returned by ChurchTools are stored in a private read-only profile.")}</p>
      <div className="form-row"><label>{t("From")}<input type="date" value={migrationStartDate} max={migrationEndDate} onChange={(event) => { setMigrationStartDate(event.target.value); setMigrationPreview(null); }} /></label><label>{t("Through")}<input type="date" value={migrationEndDate} min={migrationStartDate} onChange={(event) => { setMigrationEndDate(event.target.value); setMigrationPreview(null); }} /></label></div>
      <label><input type="checkbox" checked={includeBookingHistory} onChange={(event) => { setIncludeBookingHistory(event.target.checked); setMigrationPreview(null); }} /> {t("Include read-only booking history in this date range")}</label>
      <label><input type="checkbox" checked={includeSongCatalog} onChange={(event) => { setIncludeSongCatalog(event.target.checked); setMigrationPreview(null); }} /> {t("Include worship song and arrangement metadata")}</label>
      {includeSongCatalog && <small className="sync-help">{t("The import includes song categories visible to the ChurchTools token. Songs and arrangements become available to worship catalog users at this location.")}</small>}
      <label><input type="checkbox" checked={includeEventAgendas} onChange={(event) => { setIncludeEventAgendas(event.target.checked); setMigrationPreview(null); }} /> {t("Include detailed service plans from event agendas")}</label>
      {includeEventAgendas && <small className="sync-help">{t("Choose a date range with up to 500 events. Imported agenda items appear with the service plan. Include the worship catalog to link songs and arrangements that have yet to be imported.")}</small>}
      <label><input type="checkbox" checked={includeMembershipDetails} onChange={(event) => { setIncludeMembershipDetails(event.target.checked); setIncludeMembershipCustomFields(false); setMigrationPreview(null); }} /> {t("Include detailed group memberships")}</label>
      {includeMembershipDetails && <small className="sync-help">{t("The import uses memberships visible to the ChurchTools token. Remarks, planned exits and waiting-list positions are available in Sync settings to site administrators.")}</small>}
      {includeMembershipDetails && <label><input type="checkbox" checked={includeMembershipCustomFields} onChange={(event) => { setIncludeMembershipCustomFields(event.target.checked); setMigrationPreview(null); }} /> {t("Archive visible custom membership fields for site administrators")}</label>}
      <div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void previewMigration()} disabled={busy || !migrationStartDate || !migrationEndDate}><RefreshCw size={15} />{busy ? t("Loading preview…") : t("Preview migration")}</button></div>
      {migrationPreview && <div className="sync-connection-form" aria-live="polite"><div className="sync-feedback"><strong><span>{t("Migration preview")}</span> · {migrationPreview.startDate} – {migrationPreview.endDate}</strong><span>{migrationPreview.total} <span>{t("source records")}</span> · {migrationPreview.create} <span>{t("new")}</span> · {migrationPreview.update} <span>{t("linked updates")}</span> · {migrationPreview.review} <span>{t("conflicts")}</span> · {migrationPreview.invalid} <span>{t("invalid")}</span></span><small>{migrationPreview.unmappedFields} <span>{t("source fields are not mapped.")}</span></small></div>{migrationPreview.sample.map((item, index) => <div className="sync-feedback" key={`${item.area}-${item.name}-${item.date ?? ""}-${index}`}><strong>{t(item.name || item.area)}</strong><span>{t(item.area)}{item.date ? ` · ${item.date}` : ""}{item.email ? ` · ${item.email}` : ""}{item.relationshipsCount ? ` · ${item.relationshipsCount} ${t("relationship records")}` : ""} · {t(item.action.replaceAll("_", " "))}</span>{item.unmappedFields?.length ? <small>{t("Unsupported ChurchTools plan fields: {fields}").replace("{fields}", item.unmappedFields.join(", "))}</small> : null}</div>)}<small className="sync-help">{t("Only the first 40 records are shown. The saved snapshot is encrypted; each import request processes at most 50 records and can resume after a reload.")}</small><button className="button button-primary" type="button" onClick={() => void importMigration()} disabled={busy || !migrationPreview.complete || migrationPreview.create + migrationPreview.update === 0}><Check size={15} />{busy ? t("Importing…") : t("Import reviewed records")}</button></div>}
      {migrationPreview?.bookingHistory && <p className="sync-help">{migrationPreview.bookingHistory.series} {t("booking records")} · {migrationPreview.bookingHistory.occurrences} {t("occurrences")} · {migrationPreview.bookingHistory.anonymized} {t("anonymized")}</p>}
      {migrationPreview?.songCatalog && <p className="sync-help">{migrationPreview.songCatalog.songs} {t("songs found")} · {migrationPreview.songCatalog.arrangements} {t("arrangements found")} · {migrationPreview.songCatalog.conflicts} {t("song conflicts")}</p>}
      {migrationPreview?.eventAgendas && <p className="sync-help">{migrationPreview.eventAgendas.available} {t("event agendas found")} · {migrationPreview.eventAgendas.missing} {t("missing")} · {migrationPreview.eventAgendas.forbidden} {t("permission denied")} · {migrationPreview.eventAgendas.skipped} {t("skipped")} · {migrationPreview.eventAgendas.songSelections} {t("song selections found")}</p>}
      {migrationPreview?.groupMemberships && <p className="sync-help">{migrationPreview.groupMemberships.members} {t("membership records")} · {migrationPreview.groupMemberships.withRestrictedDetails} {t("with restricted details")} · {migrationPreview.groupMemberships.concealed} {t("concealed by ChurchTools")} · {migrationPreview.groupMemberships.unknownRoles} {t("unknown roles")} · {migrationPreview.groupMemberships.eligibleCustomFields} {t("custom field values eligible")} · {migrationPreview.groupMemberships.excludedCustomFields} {t("custom field values excluded")}</p>}
      {status.migration && <div className="sync-feedback" aria-live="polite"><strong>{t("Migration progress")}</strong><span>{status.migration.complete ? t("Complete") : <>{status.migration.page} {t("of")} {status.migration.total} <span>{t("records processed")}</span></>} · {status.migration.created} <span>{t("created")}</span> · {status.migration.updated} <span>{t("updated")}</span> · {status.migration.skipped} <span>{t("skipped")}</span> · {status.migration.failed ?? 0} <span>{t("failed")}</span></span>{!status.migration.complete && status.migration.previewAt && <button className="button button-secondary" type="button" onClick={() => void importMigration()} disabled={busy}>{t("Continue migration")}</button>}{Boolean(status.migration.failed) && <><small><span>{t("Failed source records:")}</span> {(status.migration.failedRecords ?? []).map((record) => `${t(record.area)} ${record.sourceId}`).join(", ")}</small><button className="button button-secondary" type="button" onClick={() => void importMigration(true)} disabled={busy}>{t("Retry migration")}</button></>}</div>}
    </section>}
    {settingsPanel && status?.configured && <BookingHistory key={`${departmentId}|${status.instanceUrl}`} departmentId={departmentId} revision={`${status.migration?.previewAt ?? ""}|${status.migration?.page ?? 0}`} t={t} />}
    {settingsPanel && status?.configured && <CalendarSeriesImport key={`${departmentId}|${status.instanceUrl}`} departmentId={departmentId} csrfToken={csrfToken} t={t} />}
    {settingsPanel && status?.configured && <MembershipDetails key={`${departmentId}|${status.instanceUrl}`} departmentId={departmentId} revision={`${status.migration?.previewAt ?? ""}|${status.migration?.page ?? 0}`} t={t} />}
    {settingsPanel && status?.configured && <ArrangementMediaReview key={`${departmentId}|${status.instanceUrl}`} departmentId={departmentId} csrfToken={csrfToken} t={t} />}
    {settingsPanel && status?.configured && <ServiceTemplateImport key={`${departmentId}|${status.instanceUrl}`} departmentId={departmentId} csrfToken={csrfToken} t={t} />}
    {settingsPanel && status?.configured && <FinancePreview key={`${departmentId}|${status.instanceUrl}`} departmentId={departmentId} t={t} />}
    {status?.configured && <section className="directory-card sync-controls-card"><div><h2>{t("Module controls")}</h2><p>{t("Pause scheduled sync and keep the imported records, or remove the connection and delete its imported records from this site.")}</p></div><div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void toggle()} disabled={busy}>{status.enabled ? t("Pause sync") : t("Enable sync")}</button><button className="button button-danger" type="button" onClick={() => void remove()} disabled={busy || totalImported === 0 && !status.configured}><Trash2 size={14} />{t("Remove sync and imported data")}</button></div></section>}
    <footer className="page-footer"><span>{t("Automatically syncs every 15 minutes while enabled.")}</span><span>{t("Only site administrators can manage this connection.")}</span></footer>
  </div>;
}
