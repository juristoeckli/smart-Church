import { useEffect, useState, type FormEvent } from "react";
import { Check, CircleAlert, Link2, RefreshCw, Unplug } from "lucide-react";

type Direction = "off" | "bidirectional" | "elvanto_to_smart_church" | "smart_church_to_elvanto";
type Area = "people" | "peopleFlows" | "groups" | "services" | "songs" | "calendar" | "financial";
type Directions = Record<Area, Direction>;
type ImportProgress = { page: number; total: number | null; created: number; updated: number; skipped: number; complete: boolean };
type Status = { configured: boolean; directions: Directions; financialEnabled: boolean; lastConnectedAt: string | null; lastSyncAt: string | null; lastSyncError: string | null; peopleImport: ImportProgress | null; groupsImport: ImportProgress | null };
type PermissionCheck = { area: Area; accessible: boolean; recordCount?: number; detail?: string };
type PeoplePreview = {
  scannedCount: number; reportedTotal: number | null; complete: boolean;
  createCount: number; alreadyLinkedCount: number; emailMatchCount: number; ambiguousEmailCount: number; invalidCount: number;
  sample: Array<{ firstName: string; lastName: string; email: string | null; action: string }>;
};
type GroupsPreview = {
  scannedCount: number; reportedTotal: number | null; complete: boolean;
  createCount: number; alreadyLinkedCount: number; nameConflictCount: number; invalidCount: number;
  memberCount: number; linkedMemberCount: number; unmatchedMemberCount: number;
  sample: Array<{ name: string; action: string; members: number; linkedMembers: number }>;
};

const areas: Array<{ id: Area; label: string }> = [
  { id: "people", label: "People and volunteers" },
  { id: "peopleFlows", label: "People Flows" },
  { id: "groups", label: "Groups and memberships" },
  { id: "services", label: "Services, plans, and volunteers" },
  { id: "songs", label: "Songs and arrangements" },
  { id: "calendar", label: "Calendar events" },
  { id: "financial", label: "Financial and giving data" },
];
const offDirections: Directions = { people: "off", peopleFlows: "off", groups: "off", services: "off", songs: "off", calendar: "off", financial: "off" };

export function ElvantoSyncSettings({ departmentId }: { departmentId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [directions, setDirections] = useState<Directions>(offDirections);
  const [apiKey, setApiKey] = useState("");
  const [financialEnabled, setFinancialEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [permissionChecks, setPermissionChecks] = useState<PermissionCheck[] | null>(null);
  const [peoplePreview, setPeoplePreview] = useState<PeoplePreview | null>(null);
  const [groupsPreview, setGroupsPreview] = useState<GroupsPreview | null>(null);

  async function load() {
    try {
      const response = await fetch("/api/modules/sync/elvanto", { headers: { "x-department-id": departmentId } });
      const result = await response.json() as Status | { error?: string };
      if (!response.ok || !("configured" in result)) throw new Error("error" in result ? result.error ?? "Could not load Elvanto settings." : "Could not load Elvanto settings.");
      setStatus(result); setDirections(result.directions ?? offDirections); setFinancialEnabled(result.financialEnabled); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load Elvanto settings."); }
  }
  useEffect(() => { void load(); }, [departmentId]);

  function setAll(direction: Direction) {
    setDirections(Object.fromEntries(areas.map(({ id }) => [id, id === "financial" && !financialEnabled ? "off" : direction])) as Directions);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback(""); setError("");
    try {
      const response = await fetch("/api/modules/sync/elvanto", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-department-id": departmentId },
        body: JSON.stringify({ ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), directions, financialEnabled }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not verify Elvanto.");
      setApiKey(""); setFeedback("Elvanto connection verified and settings saved. Sync is not active yet."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not verify Elvanto."); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect Elvanto and remove the saved API key and sync directions?")) return;
    setBusy(true); setFeedback(""); setError("");
    try {
      const response = await fetch("/api/modules/sync/elvanto", { method: "DELETE", headers: { "x-department-id": departmentId } });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not disconnect Elvanto.");
      setApiKey(""); setFeedback("Elvanto disconnected."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not disconnect Elvanto."); }
    finally { setBusy(false); }
  }

  async function checkPermissions() {
    setBusy(true); setFeedback(""); setError(""); setPermissionChecks(null);
    try {
      const response = await fetch("/api/modules/sync/elvanto/check-permissions", { method: "POST", headers: { "x-department-id": departmentId } });
      const result = await response.json() as { checks?: PermissionCheck[]; error?: string };
      if (!response.ok || !Array.isArray(result.checks)) throw new Error(result.error ?? "Could not check Elvanto API permissions.");
      setPermissionChecks(result.checks);
      setFeedback("API permission checks finished.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not check Elvanto API permissions."); }
    finally { setBusy(false); }
  }

  async function previewPeople() {
    setBusy(true); setFeedback(""); setError(""); setPeoplePreview(null);
    try {
      const response = await fetch("/api/modules/sync/elvanto/people-preview", { method: "POST", headers: { "x-department-id": departmentId } });
      const result = await response.json() as PeoplePreview & { error?: string };
      if (!response.ok || !Array.isArray(result.sample)) throw new Error(result.error ?? "Could not preview Elvanto people.");
      setPeoplePreview(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not preview Elvanto people."); }
    finally { setBusy(false); }
  }

  async function importPeople() {
    const createCount = peoplePreview?.createCount ?? 0;
    const updateCount = peoplePreview?.alreadyLinkedCount ?? 0;
    if (!peoplePreview?.complete) return;
    if (createCount + updateCount <= 0) return;
    setBusy(true); setFeedback(""); setError("");
    try {
      const response = await fetch("/api/modules/sync/elvanto/people-import", { method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId }, ...(status?.peopleImport?.complete ? { body: JSON.stringify({ restart: true }) } : {}) });
      const result = await response.json() as { peopleImport?: NonNullable<Status["peopleImport"]>; error?: string };
      if (!response.ok || !result.peopleImport) throw new Error(result.error ?? "Could not import Elvanto people.");
      await load();
      setFeedback(result.peopleImport.complete ? "Elvanto People import is complete." : "Batch complete. Continue the import to resume.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not import Elvanto people."); }
    finally { setBusy(false); }
  }

  async function previewGroups() {
    setBusy(true); setFeedback(""); setError(""); setGroupsPreview(null);
    try {
      const response = await fetch("/api/modules/sync/elvanto/groups-preview", { method: "POST", headers: { "x-department-id": departmentId } });
      const result = await response.json() as GroupsPreview & { error?: string };
      if (!response.ok || !Array.isArray(result.sample)) throw new Error(result.error ?? "Could not preview Elvanto groups.");
      setGroupsPreview(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not preview Elvanto groups."); }
    finally { setBusy(false); }
  }

  async function importGroups() {
    if (!groupsPreview?.complete || groupsPreview.createCount + groupsPreview.alreadyLinkedCount <= 0) return;
    setBusy(true); setFeedback(""); setError("");
    try {
      const response = await fetch("/api/modules/sync/elvanto/groups-import", { method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId }, ...(status?.groupsImport?.complete ? { body: JSON.stringify({ restart: true }) } : {}) });
      const result = await response.json() as { groupsImport?: ImportProgress; error?: string };
      if (!response.ok || !result.groupsImport) throw new Error(result.error ?? "Could not import Elvanto groups.");
      await load();
      setFeedback(result.groupsImport.complete ? "Elvanto Groups import is complete." : "Group batch complete. Continue the import to resume.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not import Elvanto groups."); }
    finally { setBusy(false); }
  }

  return <section className="directory-card sync-settings-card elvanto-settings-card">
    <div className="directory-heading"><div><h2>Elvanto</h2><p>{status?.configured ? "Connection verified" : "Connect this location to Elvanto."}</p></div>{status?.configured && <span className="event-kind event-kind-service">Connected</span>}</div>
    <div className="demo-notice demo-notice-error"><span className="demo-dot" /><span>Read-only People and Groups previews with resumable Elvanto-to-Smart-Church imports are available.</span> <span>Other data areas, exports, and bidirectional sync are still under development.</span></div>
    <form className="sync-connection-form" onSubmit={(event) => void save(event)}>
      <label>Elvanto Secret API Key<input type="password" autoComplete="new-password" placeholder={status?.configured ? "Leave blank to keep the saved key" : "Paste the Elvanto API key"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></label>
      <p className="sync-help">Find the key in Elvanto under Settings → Developers → API. It is encrypted on the server and never sent back to this screen. The connection check requires People read access.</p>
      <div className="community-inline-actions"><span>Apply direction to all areas:</span><button type="button" className="button button-secondary" disabled={busy} onClick={() => setAll("bidirectional")}>Bidirectional</button><button type="button" className="button button-secondary" disabled={busy} onClick={() => setAll("elvanto_to_smart_church")}>Elvanto → Smart Church</button><button type="button" className="button button-secondary" disabled={busy} onClick={() => setAll("smart_church_to_elvanto")}>Smart Church → Elvanto</button></div>
      <div className="sync-connection-form">{areas.map(({ id, label }) => <label key={id}>{label}<select value={directions[id]} disabled={busy || id === "financial" && !financialEnabled} onChange={(event) => setDirections((current) => ({ ...current, [id]: event.target.value as Direction }))}><option value="off">Disabled</option><option value="bidirectional">Bidirectional</option><option value="elvanto_to_smart_church">Elvanto to Smart Church</option><option value="smart_church_to_elvanto">Smart Church to Elvanto</option></select></label>)}</div>
      <label className="community-resource-check"><input type="checkbox" checked={financialEnabled} disabled={busy} onChange={(event) => { setFinancialEnabled(event.target.checked); if (!event.target.checked) setDirections((current) => ({ ...current, financial: "off" })); }} />I explicitly authorize financial and giving data access for this location.</label>
      <div className="form-actions"><button className="button button-primary" type="submit" disabled={busy || (!apiKey.trim() && !status?.configured)}><Check size={15} />{busy ? "Verifying…" : "Test connection and save"}</button>{status?.configured && <button className="button button-danger" type="button" onClick={() => void disconnect()} disabled={busy}><Unplug size={15} />Disconnect</button>}</div>
    </form>
    {status?.configured && <div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void checkPermissions()} disabled={busy || !areas.some(({ id }) => directions[id] !== "off" && (id !== "financial" || financialEnabled))}><RefreshCw size={15} />{busy ? "Checking permissions…" : "Check selected API permissions"}</button><span className="sync-help">Checks read access only; no Elvanto records are imported or changed.</span></div>}
    {status?.configured && directions.people !== "off" && directions.people !== "smart_church_to_elvanto" && <div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void previewPeople()} disabled={busy}><RefreshCw size={15} />{busy ? "Loading preview…" : "Preview People import"}</button><span className="sync-help">Reads Elvanto people and compares them with this location. No records are written.</span></div>}
    {status?.configured && directions.groups !== "off" && directions.groups !== "smart_church_to_elvanto" && <div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void previewGroups()} disabled={busy}><RefreshCw size={15} />{busy ? "Loading preview…" : "Preview Groups import"}</button><span className="sync-help">Preview shows up to 50 groups. Existing Elvanto groups will refresh; only memberships for imported groups are replaced.</span></div>}
    {status?.configured && status.peopleImport && <div className="sync-feedback" aria-live="polite"><strong>People import progress</strong><span>{status.peopleImport.complete ? "Complete" : <>Next Elvanto page: {status.peopleImport.page}</>}{status.peopleImport.total !== null && <> · {status.peopleImport.total} records</>} · {status.peopleImport.created} created · {status.peopleImport.updated} updated · {status.peopleImport.skipped} skipped</span></div>}
    {status?.configured && status.groupsImport && <div className="sync-feedback" aria-live="polite"><strong>Groups import progress</strong><span>{status.groupsImport.complete ? "Complete" : <>Next Elvanto page: {status.groupsImport.page}</>}{status.groupsImport.total !== null && <> · {status.groupsImport.total} groups</>} · {status.groupsImport.created} created · {status.groupsImport.updated} updated · {status.groupsImport.skipped} skipped</span></div>}
    {permissionChecks && <div className="sync-connection-form" aria-live="polite">{permissionChecks.map((check) => <div className="sync-feedback" key={check.area}><span className={check.accessible ? "event-kind event-kind-service" : "event-kind event-kind-other"}>{check.accessible ? "Read access confirmed" : "Read access failed"}</span><strong>{areas.find(({ id }) => id === check.area)?.label}</strong>{typeof check.recordCount === "number" && <span>{check.recordCount} records</span>}{check.detail && <small>{check.detail}</small>}</div>)}</div>}
    {peoplePreview && <div className="sync-connection-form" aria-live="polite">
      <div className="sync-feedback"><strong>People import preview</strong><span>{peoplePreview.scannedCount} scanned{peoplePreview.reportedTotal !== null && <> of {peoplePreview.reportedTotal} reported by Elvanto</>}{!peoplePreview.complete && <em> — preview is incomplete</em>}</span></div>
      <div className="sync-feedback"><span>{peoplePreview.createCount} new</span> · <span>{peoplePreview.alreadyLinkedCount} already linked</span> · <span>{peoplePreview.emailMatchCount} email matches needing review</span> · <span>{peoplePreview.ambiguousEmailCount} ambiguous email matches</span> · <span>{peoplePreview.invalidCount} records needing review</span></div>
      {peoplePreview.sample.map((person, index) => <div className="sync-feedback" key={`${person.email ?? person.firstName}-${index}`}><strong>{person.firstName} {person.lastName}</strong><span>{person.email || "No email"} · {person.action === "already_linked" ? "Already linked" : person.action === "review_email_match" ? "Review email match" : person.action === "review_ambiguous_email" ? "Review ambiguous email match" : person.action === "needs_review" ? "Needs review" : person.action === "duplicate_source_id" ? "Duplicate Elvanto ID" : "New contact"}</span></div>)}
      <small className="sync-help">Email matches are shown for review only. They will not be merged automatically.</small>
      <div className="community-inline-actions"><button className="button button-primary" type="button" onClick={() => void importPeople()} disabled={busy || !peoplePreview.complete || (peoplePreview.createCount + peoplePreview.alreadyLinkedCount === 0)}><Check size={15} />{busy ? "Importing…" : status?.peopleImport?.complete ? "Refresh People from Elvanto" : status?.peopleImport ? "Continue People import" : "Import eligible contacts"}</button><span className="sync-help">Requires a complete preview. Work advances five Elvanto pages per batch; email matches are skipped for manual resolution.</span></div>
    </div>}
    {groupsPreview && <div className="sync-connection-form" aria-live="polite">
      <div className="sync-feedback"><strong>Groups import preview</strong><span>{groupsPreview.scannedCount} scanned{groupsPreview.reportedTotal !== null && <> of {groupsPreview.reportedTotal} reported by Elvanto</>}{!groupsPreview.complete && <em> — preview is incomplete</em>}</span></div>
      <div className="sync-feedback"><span>{groupsPreview.createCount} new groups</span> · <span>{groupsPreview.alreadyLinkedCount} already linked</span> · <span>{groupsPreview.nameConflictCount} name conflicts to review</span> · <span>{groupsPreview.invalidCount} invalid groups</span></div>
      <div className="sync-feedback"><span>{groupsPreview.memberCount} member assignments found</span> · <span>{groupsPreview.linkedMemberCount} members linked to imported Elvanto people</span> · <span>{groupsPreview.unmatchedMemberCount} members need the People import first</span></div>
      {groupsPreview.sample.map((group, index) => <div className="sync-feedback" key={`${group.name}-${index}`}><strong>{group.name}</strong><span>{group.members} members · {group.linkedMembers} linked · {group.action === "already_linked" ? "Already linked" : group.action === "review_name_conflict" ? "Review name conflict" : group.action === "needs_review" ? "Needs review" : group.action === "duplicate_source_id" ? "Duplicate Elvanto ID" : "New group"}</span></div>)}
      <small className="sync-help">Requires a complete preview. Work advances five Elvanto pages per batch. Same-name groups are skipped for manual resolution.</small>
      <div className="community-inline-actions"><button className="button button-primary" type="button" onClick={() => void importGroups()} disabled={busy || !groupsPreview.complete || groupsPreview.createCount + groupsPreview.alreadyLinkedCount === 0}><Check size={15} />{busy ? "Importing…" : status?.groupsImport?.complete ? "Refresh Groups from Elvanto" : status?.groupsImport ? "Continue Groups import" : "Import eligible groups"}</button></div>
    </div>}
    {feedback && <p className="sync-feedback" role="status"><Link2 size={15} />{feedback}</p>}
    {error && <p className="sync-feedback sync-feedback-error" role="alert"><CircleAlert size={15} />{error}</p>}
  </section>;
}
