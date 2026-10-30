import { useEffect, useState, type FormEvent } from "react";
import { Check, CircleAlert, Link2, RefreshCw, Unplug } from "lucide-react";
import { getActiveLanguage } from "../../i18n";
import { translateModuleMessage } from "../translations";
import { ElvantoSongLibraryImport } from "./ElvantoSongLibraryImport";
import { ElvantoPeopleFlowCrosswalk } from "./ElvantoPeopleFlowCrosswalk";

type Direction = "off" | "bidirectional" | "elvanto_to_smart_church" | "smart_church_to_elvanto";
type Area = "people" | "peopleFlows" | "groups" | "services" | "songs" | "calendar" | "financial";
type Directions = Record<Area, Direction>;
type ImportProgress = { page: number; total: number | null; created: number; updated: number; skipped: number; complete: boolean };
type PermissionCheck = { area: Area; accessible: boolean; recordCount?: number; detail?: string };
type PeoplePreview = {
  scannedCount: number; reportedTotal: number | null; complete: boolean;
  customFieldCount: number;
  createCount: number; alreadyLinkedCount: number; emailMatchCount: number; ambiguousEmailCount: number; invalidCount: number;
  sample: Array<{ firstName: string; lastName: string; email: string | null; action: string }>;
};
type IncrementalPerson = { sourceId: string; action: string; modifiedAt: string | null; remote: Record<string, unknown>; local: Record<string, unknown> | null; candidates?: Array<Record<string, unknown>>; resolution: "use_elvanto" | "keep_local" | "skip" | null };
type IncrementalPeoplePreview = { previewId: string; cursorFrom: string; cursorTo: string; complete: boolean; scannedCount: number; reportedTotal: number | null; createCount: number; updateCount: number; conflictCount: number; reviewCount: number; skippedCount: number; sample: IncrementalPerson[] };
type IncrementalPeopleProgress = { cursorAt: string | null; previewId: string | null; previewAt: string | null; total: number; processed: number; created: number; updated: number; skipped: number; review: number; complete: boolean };
type PeopleExportPreview = { complete: boolean; total: number; create: number; update: number; review: number; sample: Array<{ firstName: string; lastName: string; email: string | null; action: string }> };
type GroupsExportPreview = { complete: boolean; groups: number; total: number; create: number; update: number; addMembers: number; review: number; missingPeople: number; remoteOnlyMembers: number; sample: Array<{ name: string; action: string; membersToAdd: number; missingPeople: number; remoteOnlyMembers: number }> };
type GroupsPreview = {
  scannedCount: number; reportedTotal: number | null; complete: boolean;
  createCount: number; updateCount: number; alreadyLinkedCount: number; memberAddCount: number; nameConflictCount: number; invalidCount: number;
  memberCount: number; linkedMemberCount: number; unmatchedMemberCount: number; localOnlyMemberCount: number;
  sample: Array<{ name: string; action: string; members: number; linkedMembers: number; membersToAdd: number; changedFields: string[] }>;
};
type ServicesPreview = {
  scannedCount: number; reportedTotal: number | null; complete: boolean;
  createCount: number; updateCount: number; alreadyLinkedCount: number; conflictCount: number; invalidCount: number;
  assignmentCreateCount: number; assignmentChangeCount: number; missingPeopleLinkCount: number;
  sample: Array<{ title: string; date: string; action: string; changedFields: string[] }>;
};
type CalendarPreview = {
  scannedCount: number; reportedTotal: number | null; complete: boolean; startDate: string; endDate: string;
  createCount: number; updateCount: number; alreadyLinkedCount: number; conflictCount: number; invalidCount: number;
  sample: Array<{ title: string; date: string; action: string; changedFields: string[] }>;
};
type CalendarExportOptions = { calendars: Array<{ id: string; name: string; published: boolean }>; organizers: Array<{ id: string; name: string }>; organizersPage: number; organizersTotal: number };
type CalendarExportPreview = { complete: boolean; total: number; create: number; update: number; review: number; timeZone: string; startDate: string; endDate: string; calendar: { id: string; name: string }; organizer: { id: string; name: string }; sample: Array<{ title: string; date: string; isAllDay: boolean; start: string | null; end: string | null; location: string; action: string }> };
type PeopleFlowsPreview = {
  flowCount: number; reportedFlowCount: number; stepCount: number; assignmentCount: number; complete: boolean;
  createCount: number; updateCount: number;
  sample: Array<{ name: string; steps: number; assignments: number; action: string }>;
};
type PeopleFlowsImportProgress = ImportProgress & { lastImportAt: string | null };
type SongsPreview = { songCount: number; reportedSongCount: number; complete: boolean; createCount: number; updateCount: number; sample: Array<{ title: string; arrangements: number; action: string }> };
type SongsExportPreview = { complete: boolean; total: number; create: number; update: number; unchanged: number; review: number; sample: Array<{ title: string; arrangements: number; action: string; unsupportedFields: string[] }> };
type SongsImportProgress = ImportProgress & { previewComplete: boolean; previewCount: number; importedCount: number; lastImportAt: string | null };
type FinancialPreview = { transactionCount: number; reportedTotal: number; complete: boolean; createCount: number; updateCount: number; sample: Array<{ date: string; total: string; action: string }> };
type FinancialItem = { sourceId: string; date: string; total: string | number; importedAt: string };
type FinancialDetail = { sourceId: string; date: string; transaction: Record<string, unknown>; importedAt: string };
type FinancialImportProgress = ImportProgress & { previewComplete: boolean; previewCount: number; startDate: string | null; endDate: string | null };
type ImportedSong = { sourceId: string; title: string; arrangements: number; importedAt: string };
type SongDetail = { sourceId: string; title: string; song: Record<string, unknown>; arrangements: Array<Record<string, unknown>>; importedAt: string };
type ImportedPeopleFlow = { sourceId: string; name: string; steps: number; members: number; importedAt: string };
type PeopleFlowDetail = { sourceId: string; name: string; definition: { steps: Array<{ id: string; parentStepId: string | null; name: string; description: string; instructions: string; priority: string; due: Record<string, unknown>; admins: Array<{ id: string; role: string }> }> }; members: Array<{ stepId: string; stepName: string; personId: string; status: string; assignedAdminId: string; dueDate: string; completedDate: string; completedBy: string; contactId: string | null; contactName: string | null }>; memberOffset: number; memberTotal: number; importedAt: string };
type ServiceAuditEntry = { action: string; outcome: string; details: Record<string, unknown>; createdAt: string };
type SyncAuditEntry = { area: string; action: string; outcome: string; createdAt: string; summary: Record<string, number | boolean> };
type Status = { configured: boolean; serviceAudit: ServiceAuditEntry[]; directions: Directions; financialEnabled: boolean; lastConnectedAt: string | null; lastSyncAt: string | null; lastSyncError: string | null; peopleIncremental: IncrementalPeopleProgress | null; peopleImport: ImportProgress | null; peopleExport: (ImportProgress & { previewAt: string | null }) | null; peopleFlowsImport: PeopleFlowsImportProgress | null; peopleFlows: ImportedPeopleFlow[]; songsImport: SongsImportProgress | null; songsExport: (ImportProgress & { previewAt: string | null }) | null; songs: ImportedSong[]; songsTotal: number; financialImport: FinancialImportProgress | null; groupsImport: ImportProgress | null; groupsExport: (ImportProgress & { addedMembers: number; previewAt: string | null }) | null; servicesImport: ImportProgress | null; calendarImport: (ImportProgress & { startDate: string | null; endDate: string | null }) | null; calendarExport: (ImportProgress & { previewAt: string | null; calendarId: string | null; organizerId: string | null }) | null };

function shiftUtcYear(years: number) {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
}

const areas: Array<{ id: Area; label: string }> = [
  { id: "people", label: "People and volunteers" },
  { id: "peopleFlows", label: "People Flows" },
  { id: "groups", label: "Groups and memberships" },
  { id: "services", label: "Services, plans, and volunteers" },
  { id: "songs", label: "Songs and arrangements" },
  { id: "calendar", label: "Calendar events" },
  { id: "financial", label: "Financial and giving data" },
];
const readOnlyAreas: Area[] = ["services", "financial"];
const offDirections: Directions = { people: "off", peopleFlows: "off", groups: "off", services: "off", songs: "off", calendar: "off", financial: "off" };

export function ElvantoSyncSettings({ departmentId }: { departmentId: string }) {
  const tr = (message: string) => translateModuleMessage("sync", getActiveLanguage(), message);
  const incrementalActionLabel = (action: string) => tr(({ create: "new", update: "safe updates", conflict: "linked conflict", review_email_match: "email match needs review", invalid: "invalid record", duplicate: "duplicate Elvanto ID" } as Record<string, string>)[action] ?? action.replaceAll("_", " "));
  const [status, setStatus] = useState<Status | null>(null);
  const [syncAudit, setSyncAudit] = useState<SyncAuditEntry[]>([]);
  const [directions, setDirections] = useState<Directions>(offDirections);
  const [apiKey, setApiKey] = useState("");
  const [financialEnabled, setFinancialEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [permissionChecks, setPermissionChecks] = useState<PermissionCheck[] | null>(null);
  const [peoplePreview, setPeoplePreview] = useState<PeoplePreview | null>(null);
  const [incrementalPeoplePreview, setIncrementalPeoplePreview] = useState<IncrementalPeoplePreview | null>(null);
  const [incrementalPeopleRows, setIncrementalPeopleRows] = useState<IncrementalPerson[]>([]);
  const [incrementalPeopleOffset, setIncrementalPeopleOffset] = useState(0);
  const [incrementalPeopleTotal, setIncrementalPeopleTotal] = useState(0);
  const [peopleExportPreview, setPeopleExportPreview] = useState<PeopleExportPreview | null>(null);
  const [groupsPreview, setGroupsPreview] = useState<GroupsPreview | null>(null);
  const [groupsExportPreview, setGroupsExportPreview] = useState<GroupsExportPreview | null>(null);
  const [servicesPreview, setServicesPreview] = useState<ServicesPreview | null>(null);
  const [calendarStartDate, setCalendarStartDate] = useState(() => shiftUtcYear(-5));
  const [calendarEndDate, setCalendarEndDate] = useState(() => shiftUtcYear(5));
  const [calendarPreview, setCalendarPreview] = useState<CalendarPreview | null>(null);
  const [calendarExportOptions, setCalendarExportOptions] = useState<CalendarExportOptions | null>(null);
  const [calendarExportCalendarId, setCalendarExportCalendarId] = useState("");
  const [calendarExportOrganizerId, setCalendarExportOrganizerId] = useState("");
  const [calendarExportPreview, setCalendarExportPreview] = useState<CalendarExportPreview | null>(null);
  const [calendarExportStartDate, setCalendarExportStartDate] = useState(() => shiftUtcYear(-5));
  const [calendarExportEndDate, setCalendarExportEndDate] = useState(() => shiftUtcYear(5));
  const [peopleFlowsPreview, setPeopleFlowsPreview] = useState<PeopleFlowsPreview | null>(null);
  const [peopleFlowDetail, setPeopleFlowDetail] = useState<PeopleFlowDetail | null>(null);
  const [songsPreview, setSongsPreview] = useState<SongsPreview | null>(null);
  const [songsExportPreview, setSongsExportPreview] = useState<SongsExportPreview | null>(null);
  const [songDetail, setSongDetail] = useState<SongDetail | null>(null);
  const [financialStartDate, setFinancialStartDate] = useState("");
  const [financialEndDate, setFinancialEndDate] = useState("");
  const [financialPreview, setFinancialPreview] = useState<FinancialPreview | null>(null);
  const [financialTransactions, setFinancialTransactions] = useState<FinancialItem[]>([]);
  const [financialTotal, setFinancialTotal] = useState(0);
  const [financialDetail, setFinancialDetail] = useState<FinancialDetail | null>(null);

  async function load() {
    try {
      const response = await fetch("/api/modules/sync/elvanto", { headers: { "x-department-id": departmentId } });
      const result = await response.json() as Status | { error?: string };
      if (!response.ok || !("configured" in result)) throw new Error("error" in result ? result.error ?? "Could not load Elvanto settings." : "Could not load Elvanto settings.");
      const requestedDirections = result.directions ?? offDirections;
      const normalizedDirections = { ...requestedDirections };
      for (const area of readOnlyAreas) {
        if (area === "financial" && !result.financialEnabled) normalizedDirections[area] = "off";
        else if (normalizedDirections[area] !== "off" && normalizedDirections[area] !== "elvanto_to_smart_church") normalizedDirections[area] = "elvanto_to_smart_church";
      }
      setStatus(result); setDirections(normalizedDirections); setFinancialEnabled(result.financialEnabled);
      try {
        const auditResponse = await fetch("/api/modules/sync/elvanto/audit?limit=50", { headers: { "x-department-id": departmentId } });
        const auditResult = await auditResponse.json() as { entries?: SyncAuditEntry[] };
        if (auditResponse.ok && Array.isArray(auditResult.entries)) setSyncAudit(auditResult.entries);
      } catch { /* Sync status remains usable when audit history is temporarily unavailable. */ }
      if (result.peopleIncremental?.previewId && !result.peopleIncremental.complete && result.peopleIncremental.processed < result.peopleIncremental.total) {
        try { await loadIncrementalPeopleRows(result.peopleIncremental.previewId, 0); } catch { /* Progress remains available even when a finished review snapshot has expired. */ }
      }
      if (readOnlyAreas.some((area) => normalizedDirections[area] !== requestedDirections[area])) setFeedback("Unsupported directions were reset to their supported setting."); if (result.calendarExport?.calendarId) setCalendarExportCalendarId(result.calendarExport.calendarId); if (result.calendarExport?.organizerId) setCalendarExportOrganizerId(result.calendarExport.organizerId); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load Elvanto settings."); }
  }
  useEffect(() => { void load(); }, [departmentId]);

  function setAll(direction: Direction) {
    setDirections(Object.fromEntries(areas.map(({ id }) => [
      id,
      id === "financial" && !financialEnabled ? "off"
        : readOnlyAreas.includes(id) ? direction === "smart_church_to_elvanto" ? "off" : "elvanto_to_smart_church"
        : direction,
    ])) as Directions);
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

  async function loadIncrementalPeopleRows(previewId: string, offset: number) {
    const response = await fetch(`/api/modules/sync/elvanto/people-incremental-preview/${previewId}?offset=${offset}&limit=50`, { headers: { "x-department-id": departmentId } });
    const result = await response.json() as { previewId?: string; total?: number; offset?: number; rows?: IncrementalPerson[]; error?: string };
    if (!response.ok || !Array.isArray(result.rows)) throw new Error(tr(result.error ?? "Could not load the incremental People preview."));
    setIncrementalPeopleRows(result.rows); setIncrementalPeopleOffset(offset); setIncrementalPeopleTotal(result.total ?? 0);
  }

  async function previewIncrementalPeople() {
    setBusy(true); setFeedback(""); setError(""); setIncrementalPeoplePreview(null); setIncrementalPeopleRows([]);
    try {
      const response = await fetch("/api/modules/sync/elvanto/people-incremental-preview", { method: "POST", headers: { "x-department-id": departmentId } });
      const result = await response.json() as IncrementalPeoplePreview & { error?: string };
      if (!response.ok || !result.previewId || !Array.isArray(result.sample)) throw new Error(tr(result.error ?? "Could not preview incremental Elvanto People changes."));
      setIncrementalPeoplePreview(result); await loadIncrementalPeopleRows(result.previewId, 0); await load();
    } catch (reason) { setError(tr(reason instanceof Error ? reason.message : "Could not preview incremental Elvanto People changes.")); }
    finally { setBusy(false); }
  }

  async function resolveIncrementalPerson(sourceId: string, resolution: "use_elvanto" | "keep_local" | "skip") {
    if (!incrementalPeoplePreview) return;
    setBusy(true); setFeedback(""); setError("");
    try {
      const response = await fetch("/api/modules/sync/elvanto/people-incremental-resolve", { method: "PUT", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify({ previewId: incrementalPeoplePreview.previewId, sourceId, resolution }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(tr(result.error ?? "Could not save the People conflict decision."));
      const wasUnresolved = incrementalPeopleRows.some((person) => person.sourceId === sourceId && person.resolution === null);
      if (wasUnresolved) setIncrementalPeoplePreview((current) => current ? { ...current, reviewCount: Math.max(0, current.reviewCount - 1) } : current);
      await loadIncrementalPeopleRows(incrementalPeoplePreview.previewId, incrementalPeopleOffset);
      setFeedback(tr("People review decision saved."));
    } catch (reason) { setError(tr(reason instanceof Error ? reason.message : "Could not save the People conflict decision.")); }
    finally { setBusy(false); }
  }

  async function importIncrementalPeople() {
    const previewId = incrementalPeoplePreview?.previewId ?? status?.peopleIncremental?.previewId;
    if (!previewId) return;
    setBusy(true); setFeedback(""); setError("");
    try {
      const response = await fetch("/api/modules/sync/elvanto/people-incremental-import", { method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify({ previewId }) });
      const result = await response.json() as { peopleIncremental?: IncrementalPeopleProgress; error?: string };
      if (!response.ok || !result.peopleIncremental) throw new Error(tr(result.error ?? "Could not import incremental Elvanto People changes."));
      await load();
      setFeedback(tr(result.peopleIncremental.complete ? "Incremental Elvanto People sync is complete." : "Incremental People batch complete. Continue to resume."));
    } catch (reason) { setError(tr(reason instanceof Error ? reason.message : "Could not import incremental Elvanto People changes.")); }
    finally { setBusy(false); }
  }

  async function previewPeopleExport() {
    setBusy(true); setFeedback(""); setError(""); setPeopleExportPreview(null);
    try {
      const response = await fetch("/api/modules/sync/elvanto/people-export-preview", { method: "POST", headers: { "x-department-id": departmentId } });
      const result = await response.json() as PeopleExportPreview & { error?: string };
      if (!response.ok || !Array.isArray(result.sample)) throw new Error(result.error ?? "Could not preview People export.");
      await load(); setPeopleExportPreview(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not preview People export."); }
    finally { setBusy(false); }
  }

  async function exportPeople() {
    if ((!peopleExportPreview?.complete && !status?.peopleExport?.previewAt) || (peopleExportPreview && peopleExportPreview.create + peopleExportPreview.update <= 0)) return;
    setBusy(true); setFeedback(""); setError("");
    try {
      const response = await fetch("/api/modules/sync/elvanto/people-export", { method: "POST", headers: { "x-department-id": departmentId } });
      const result = await response.json() as { peopleExport?: ImportProgress; error?: string };
      if (!response.ok || !result.peopleExport) {
        await load(); setPeopleExportPreview(null);
        throw new Error(result.error ?? "Could not export People to Elvanto.");
      }
      await load(); setFeedback(result.peopleExport.complete ? "People export to Elvanto is complete." : "People export batch complete. Continue to resume.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not export People to Elvanto."); }
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

  async function previewGroupsExport() {
    setBusy(true); setFeedback(""); setError(""); setGroupsExportPreview(null);
    try {
      const response = await fetch("/api/modules/sync/elvanto/groups-export-preview", { method: "POST", headers: { "x-department-id": departmentId } });
      const result = await response.json() as GroupsExportPreview & { error?: string };
      if (!response.ok || !Array.isArray(result.sample)) throw new Error(result.error ?? "Could not preview Groups export.");
      await load(); setGroupsExportPreview(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not preview Groups export."); }
    finally { setBusy(false); }
  }

  async function exportGroups() {
    if ((!groupsExportPreview?.complete && !status?.groupsExport?.previewAt) || (groupsExportPreview && groupsExportPreview.create + groupsExportPreview.update + groupsExportPreview.addMembers <= 0)) return;
    setBusy(true); setFeedback(""); setError("");
    try {
      const response = await fetch("/api/modules/sync/elvanto/groups-export", { method: "POST", headers: { "x-department-id": departmentId } });
      const result = await response.json() as { groupsExport?: ImportProgress & { addedMembers: number }; error?: string };
      if (!response.ok || !result.groupsExport) { await load(); setGroupsExportPreview(null); throw new Error(result.error ?? "Could not export Groups to Elvanto."); }
      await load(); setFeedback(result.groupsExport.complete ? "Groups export to Elvanto is complete." : "Groups export batch complete. Continue to resume.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not export Groups to Elvanto."); }
    finally { setBusy(false); }
  }

  async function previewServices() {
    setBusy(true); setFeedback(""); setError(""); setServicesPreview(null);
    try {
      const response = await fetch("/api/modules/sync/elvanto/services-preview", { method: "POST", headers: { "x-department-id": departmentId } });
      const result = await response.json() as ServicesPreview & { error?: string };
      if (!response.ok || !Array.isArray(result.sample)) throw new Error(result.error ?? "Could not preview Elvanto services.");
      setServicesPreview(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not preview Elvanto services."); }
    finally { setBusy(false); }
  }

  async function importServices() {
    if (!servicesPreview?.complete || servicesPreview.createCount + servicesPreview.updateCount + servicesPreview.alreadyLinkedCount <= 0) return;
    setBusy(true); setFeedback(""); setError("");
    try {
      const response = await fetch("/api/modules/sync/elvanto/services-import", { method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId }, ...(status?.servicesImport?.complete ? { body: JSON.stringify({ restart: true }) } : {}) });
      const result = await response.json() as { servicesImport?: ImportProgress; error?: string };
      if (!response.ok || !result.servicesImport) throw new Error(result.error ?? "Could not import Elvanto services.");
      await load();
      setFeedback(result.servicesImport.complete ? "Elvanto Services import is complete." : "Service batch complete. Continue the import to resume.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not import Elvanto services."); }
    finally { setBusy(false); }
  }

  async function previewFinancial() {
    if (!financialStartDate || !financialEndDate) return;
    setBusy(true); setFeedback(""); setError(""); setFinancialPreview(null);
    try {
      const response = await fetch("/api/modules/sync/elvanto/financial-preview", { method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify({ startDate: financialStartDate, endDate: financialEndDate }) });
      const result = await response.json() as FinancialPreview & { error?: string };
      if (!response.ok || !Array.isArray(result.sample)) throw new Error(result.error ?? "Could not preview Elvanto financial records.");
      await load(); setFinancialPreview(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not preview Elvanto financial records."); }
    finally { setBusy(false); }
  }

  async function importFinancial() {
    if (!financialPreview?.complete || financialPreview.transactionCount <= 0) return;
    setBusy(true); setFeedback(""); setError("");
    try {
      const response = await fetch("/api/modules/sync/elvanto/financial-import", { method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId }, ...(status?.financialImport?.complete ? { body: JSON.stringify({ restart: true }) } : {}) });
      const result = await response.json() as { financialImport?: ImportProgress; error?: string };
      if (!response.ok || !result.financialImport) throw new Error(result.error ?? "Could not import Elvanto financial records.");
      await load(); await loadFinancialTransactions(); setFeedback(result.financialImport.complete ? "Elvanto financial import is complete." : "Financial batch complete. Continue the import to resume.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not import Elvanto financial records."); }
    finally { setBusy(false); }
  }

  async function loadFinancialTransactions(offset = 0, append = false) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/modules/sync/elvanto/financial?offset=${offset}&limit=50`, { headers: { "x-department-id": departmentId } });
      const result = await response.json() as { transactions?: FinancialItem[]; total?: number; error?: string };
      if (!response.ok || !Array.isArray(result.transactions)) throw new Error(result.error ?? "Could not load imported giving records.");
      setFinancialTransactions((current) => append ? [...current, ...result.transactions!] : result.transactions!); setFinancialTotal(result.total ?? 0);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load imported giving records."); }
    finally { setBusy(false); }
  }

  async function viewFinancialTransaction(sourceId: string) {
    setBusy(true); setError(""); setFinancialDetail(null);
    try {
      const response = await fetch(`/api/modules/sync/elvanto/financial/${encodeURIComponent(sourceId)}`, { headers: { "x-department-id": departmentId } });
      const result = await response.json() as FinancialDetail & { error?: string };
      if (!response.ok || !result.transaction) throw new Error(result.error ?? "Could not load giving record.");
      setFinancialDetail(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load giving record."); }
    finally { setBusy(false); }
  }

  async function previewSongs() {
    setBusy(true); setFeedback(""); setError(""); setSongsPreview(null);
    try {
      const response = await fetch("/api/modules/sync/elvanto/songs-preview", { method: "POST", headers: { "x-department-id": departmentId } });
      const result = await response.json() as SongsPreview & { error?: string };
      if (!response.ok || !Array.isArray(result.sample)) throw new Error(result.error ?? "Could not preview Elvanto songs.");
      await load(); setSongsPreview(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not preview Elvanto songs."); }
    finally { setBusy(false); }
  }

  async function importSongs() {
    if (!songsPreview?.complete || songsPreview.songCount <= 0) return;
    setBusy(true); setFeedback(""); setError("");
    try {
      const response = await fetch("/api/modules/sync/elvanto/songs-import", { method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId }, ...(status?.songsImport?.complete ? { body: JSON.stringify({ restart: true }) } : {}) });
      const result = await response.json() as { songsImport?: SongsImportProgress & { processedThisBatch?: number }; error?: string };
      if (!response.ok || !result.songsImport) throw new Error(result.error ?? "Could not import Elvanto songs.");
      await load(); setFeedback(result.songsImport.complete ? "Elvanto Songs import is complete." : "Songs batch complete. Continue the import to resume.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not import Elvanto songs."); }
    finally { setBusy(false); }
  }

  async function previewSongsExport() {
    setBusy(true); setFeedback(""); setError(""); setSongsExportPreview(null);
    try {
      const response = await fetch("/api/modules/sync/elvanto/songs-export-preview", { method: "POST", headers: { "x-department-id": departmentId } });
      const result = await response.json() as SongsExportPreview & { error?: string };
      if (!response.ok || !Array.isArray(result.sample)) throw new Error(result.error ?? "Could not preview Elvanto song export.");
      await load(); setSongsExportPreview(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not preview Elvanto song export."); }
    finally { setBusy(false); }
  }

  async function exportSongs() {
    if (!songsExportPreview?.complete && !status?.songsExport?.previewAt) return;
    setBusy(true); setFeedback(""); setError("");
    try {
      const response = await fetch("/api/modules/sync/elvanto/songs-export", { method: "POST", headers: { "x-department-id": departmentId } });
      const result = await response.json() as { songsExport?: ImportProgress; error?: string };
      if (!response.ok || !result.songsExport) { await load(); setSongsExportPreview(null); throw new Error(result.error ?? "Could not export songs to Elvanto."); }
      await load(); setFeedback(result.songsExport.complete ? "Song export to Elvanto is complete." : "Song export batch complete. Continue to resume.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not export songs to Elvanto."); }
    finally { setBusy(false); }
  }

  async function loadMoreSongs() {
    if (!status || status.songs.length >= status.songsTotal) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/modules/sync/elvanto/songs?offset=${status.songs.length}&limit=100`, { headers: { "x-department-id": departmentId } });
      const result = await response.json() as { songs?: ImportedSong[]; total?: number; error?: string };
      if (!response.ok || !Array.isArray(result.songs)) throw new Error(result.error ?? "Could not load more imported songs.");
      setStatus((current) => current ? { ...current, songs: [...current.songs, ...result.songs!], songsTotal: result.total ?? current.songsTotal } : current);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load more imported songs."); }
    finally { setBusy(false); }
  }

  async function viewSong(sourceId: string) {
    setBusy(true); setError(""); setSongDetail(null);
    try {
      const response = await fetch(`/api/modules/sync/elvanto/songs/${encodeURIComponent(sourceId)}`, { headers: { "x-department-id": departmentId } });
      const result = await response.json() as SongDetail & { error?: string };
      if (!response.ok || !Array.isArray(result.arrangements)) throw new Error(result.error ?? "Could not load imported song.");
      setSongDetail(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load imported song."); }
    finally { setBusy(false); }
  }

  async function previewPeopleFlows() {
    setBusy(true); setFeedback(""); setError(""); setPeopleFlowsPreview(null);
    try {
      const response = await fetch("/api/modules/sync/elvanto/people-flows-preview", { method: "POST", headers: { "x-department-id": departmentId } });
      const result = await response.json() as PeopleFlowsPreview & { error?: string };
      if (!response.ok || !Array.isArray(result.sample)) throw new Error(result.error ?? "Could not preview Elvanto People Flows.");
      await load(); setPeopleFlowsPreview(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not preview Elvanto People Flows."); }
    finally { setBusy(false); }
  }

  async function importPeopleFlows() {
    if (!peopleFlowsPreview?.complete || peopleFlowsPreview.flowCount <= 0) return;
    setBusy(true); setFeedback(""); setError("");
    try {
      const response = await fetch("/api/modules/sync/elvanto/people-flows-import", { method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId }, ...(status?.peopleFlowsImport?.complete ? { body: JSON.stringify({ restart: true }) } : {}) });
      const result = await response.json() as { peopleFlowsImport?: PeopleFlowsImportProgress; error?: string };
      if (!response.ok || !result.peopleFlowsImport) throw new Error(result.error ?? "Could not import Elvanto People Flows.");
      await load(); setFeedback(result.peopleFlowsImport.complete ? "Elvanto People Flows import is complete." : "People Flows batch complete. Continue the import to resume.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not import Elvanto People Flows."); }
    finally { setBusy(false); }
  }

  async function viewPeopleFlow(sourceId: string) {
    setBusy(true); setError(""); setPeopleFlowDetail(null);
    try {
      const response = await fetch(`/api/modules/sync/elvanto/people-flows/${encodeURIComponent(sourceId)}?offset=0&limit=100`, { headers: { "x-department-id": departmentId } });
      const result = await response.json() as PeopleFlowDetail & { error?: string };
      if (!response.ok || !Array.isArray(result.members) || !result.definition?.steps) throw new Error(result.error ?? "Could not load imported People Flow.");
      setPeopleFlowDetail(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load imported People Flow."); }
    finally { setBusy(false); }
  }

  async function loadMorePeopleFlowAssignments() {
    if (!peopleFlowDetail || peopleFlowDetail.members.length >= peopleFlowDetail.memberTotal) return;
    setBusy(true); setError("");
    try {
      const offset = peopleFlowDetail.members.length;
      const response = await fetch(`/api/modules/sync/elvanto/people-flows/${encodeURIComponent(peopleFlowDetail.sourceId)}?offset=${offset}&limit=100`, { headers: { "x-department-id": departmentId } });
      const result = await response.json() as PeopleFlowDetail & { error?: string };
      if (!response.ok || !Array.isArray(result.members)) throw new Error(result.error ?? "Could not load more assignments.");
      setPeopleFlowDetail((current) => current ? { ...result, members: [...current.members, ...result.members] } : result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load more assignments."); }
    finally { setBusy(false); }
  }

  async function previewCalendar() {
    setBusy(true); setFeedback(""); setError(""); setCalendarPreview(null);
    try {
      const response = await fetch("/api/modules/sync/elvanto/calendar-preview", { method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify({ startDate: calendarStartDate, endDate: calendarEndDate }) });
      const result = await response.json() as CalendarPreview & { error?: string };
      if (!response.ok || !Array.isArray(result.sample)) throw new Error(result.error ?? "Could not preview Elvanto calendar events.");
      await load();
      setCalendarPreview(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not preview Elvanto calendar events."); }
    finally { setBusy(false); }
  }

  async function importCalendar() {
    if (!calendarPreview?.complete || calendarPreview.createCount + calendarPreview.updateCount + calendarPreview.alreadyLinkedCount <= 0) return;
    setBusy(true); setFeedback(""); setError("");
    try {
      const response = await fetch("/api/modules/sync/elvanto/calendar-import", { method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId }, ...(status?.calendarImport?.complete ? { body: JSON.stringify({ restart: true }) } : {}) });
      const result = await response.json() as { calendarImport?: ImportProgress & { startDate: string; endDate: string }; error?: string };
      if (!response.ok || !result.calendarImport) throw new Error(result.error ?? "Could not import Elvanto calendar events.");
      await load();
      setFeedback(result.calendarImport.complete ? "Elvanto Calendar import is complete." : "Calendar batch complete. Continue the import to resume.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not import Elvanto calendar events."); }
    finally { setBusy(false); }
  }

  async function loadCalendarExportOptions(page = 1) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/modules/sync/elvanto/calendar-export-options?page=${page}`, { headers: { "x-department-id": departmentId } });
      const result = await response.json() as CalendarExportOptions & { error?: string };
      if (!response.ok || !Array.isArray(result.calendars) || !Array.isArray(result.organizers)) throw new Error(result.error ?? "Could not load Elvanto calendars and organizers.");
      setCalendarExportOptions((current) => page === 1 || !current ? result : { ...result, calendars: current.calendars, organizers: [...current.organizers, ...result.organizers.filter((person) => !current.organizers.some((existing) => existing.id === person.id))] });
      if (!calendarExportCalendarId && result.calendars[0]) setCalendarExportCalendarId(result.calendars[0].id);
      if (!calendarExportOrganizerId && result.organizers[0]) setCalendarExportOrganizerId(result.organizers[0].id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load Elvanto calendars and organizers."); }
    finally { setBusy(false); }
  }

  async function previewCalendarExport() {
    setBusy(true); setFeedback(""); setError(""); setCalendarExportPreview(null);
    try {
      const response = await fetch("/api/modules/sync/elvanto/calendar-export-preview", { method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify({ calendarId: calendarExportCalendarId, organizerId: calendarExportOrganizerId, startDate: calendarExportStartDate, endDate: calendarExportEndDate }) });
      const result = await response.json() as CalendarExportPreview & { error?: string };
      if (!response.ok || !Array.isArray(result.sample)) throw new Error(result.error ?? "Could not preview Elvanto Calendar export.");
      setCalendarExportPreview(result); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not preview Elvanto Calendar export."); }
    finally { setBusy(false); }
  }

  async function exportCalendar() {
    if ((!calendarExportPreview?.complete && !status?.calendarExport?.previewAt) || (calendarExportPreview && calendarExportPreview.create + calendarExportPreview.update === 0)) return;
    setBusy(true); setFeedback(""); setError("");
    try {
      const response = await fetch("/api/modules/sync/elvanto/calendar-export", { method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: "{}" });
      const result = await response.json() as { calendarExport?: ImportProgress; error?: string };
      if (!response.ok || !result.calendarExport) throw new Error(result.error ?? "Could not export Calendar events to Elvanto.");
      await load(); setFeedback(result.calendarExport.complete ? "Elvanto Calendar export is complete." : "Calendar export batch complete. Continue the export to resume.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not export Calendar events to Elvanto."); }
    finally { setBusy(false); }
  }

  return <section className="directory-card sync-settings-card elvanto-settings-card">
    <div className="directory-heading"><div><h2>Elvanto</h2><p>{status?.configured ? "Connection verified" : "Connect this location to Elvanto."}</p></div>{status?.configured && <span className="event-kind event-kind-service">Connected</span>}</div>
    <div className="demo-notice demo-notice-error"><span className="demo-dot" /><span>People and Groups support reviewed, resumable imports and exports. People Flows, Services, Songs, Calendar, and giving currently have one-way imports.</span> <span>Other reverse-direction sync and bidirectional conflict handling remain under development.</span></div>
    <form className="sync-connection-form" onSubmit={(event) => void save(event)}>
      <label>Elvanto Secret API Key<input type="password" autoComplete="new-password" placeholder={status?.configured ? "Leave blank to keep the saved key" : "Paste the Elvanto API key"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></label>
      <p className="sync-help">Find the key in Elvanto under Settings → Developers → API. It is encrypted on the server and never sent back to this screen. The connection check requires People read access.</p>
      <div className="community-inline-actions"><span>Apply direction to all areas:</span><button type="button" className="button button-secondary" disabled={busy} onClick={() => setAll("bidirectional")}>Bidirectional</button><button type="button" className="button button-secondary" disabled={busy} onClick={() => setAll("elvanto_to_smart_church")}>Elvanto → Smart Church</button><button type="button" className="button button-secondary" disabled={busy} onClick={() => setAll("smart_church_to_elvanto")}>Smart Church → Elvanto</button></div><small className="sync-help">Services, People Flows, and Financial data are currently read-only in Smart Church. Bidirectional and Smart Church → Elvanto presets keep these areas on Elvanto → Smart Church or Off.</small><small className="sync-help">Services are read-only: Elvanto documents service, plan, and volunteer reads but no write methods. the Bidirectional preset sets Services to Elvanto → Smart Church, and the Smart Church → Elvanto preset leaves Services disabled.</small>
      <div className="sync-connection-form">{areas.map(({ id, label }) => <label key={id}>{label}<select value={directions[id]} disabled={busy || id === "financial" && !financialEnabled} onChange={(event) => setDirections((current) => ({ ...current, [id]: event.target.value as Direction }))}><option value="off">Disabled</option>{readOnlyAreas.includes(id) ? <option value="elvanto_to_smart_church">Elvanto to Smart Church</option> : <><option value="bidirectional">Bidirectional</option><option value="elvanto_to_smart_church">Elvanto to Smart Church</option><option value="smart_church_to_elvanto">Smart Church to Elvanto</option></>}</select></label>)}</div>
      <label className="community-resource-check"><input type="checkbox" checked={financialEnabled} disabled={busy} onChange={(event) => { setFinancialEnabled(event.target.checked); if (!event.target.checked) setDirections((current) => ({ ...current, financial: "off" })); }} />I explicitly authorize financial and giving data access for this location.</label>
      <div className="form-actions"><button className="button button-primary" type="submit" disabled={busy || (!apiKey.trim() && !status?.configured)}><Check size={15} />{busy ? "Verifying…" : "Test connection and save"}</button>{status?.configured && <button className="button button-danger" type="button" onClick={() => void disconnect()} disabled={busy}><Unplug size={15} />Disconnect</button>}</div>
    </form>
    {status?.configured && <div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void checkPermissions()} disabled={busy || !areas.some(({ id }) => directions[id] !== "off" && (id !== "financial" || financialEnabled))}><RefreshCw size={15} />{busy ? "Checking permissions…" : "Check selected API permissions"}</button><span className="sync-help">Checks read access only; no Elvanto records are imported or changed.</span></div>}
    {status?.configured && directions.people !== "off" && directions.people !== "smart_church_to_elvanto" && <div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void previewPeople()} disabled={busy}><RefreshCw size={15} />{busy ? "Loading preview…" : "Preview People import"}</button><span className="sync-help">Reads Elvanto people and compares them with this location. No records are written.</span></div>}
    {status?.configured && status.peopleImport?.complete && directions.people !== "off" && directions.people !== "smart_church_to_elvanto" && <div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void previewIncrementalPeople()} disabled={busy}><RefreshCw size={15} />{busy ? tr("Loading preview…") : tr("Preview People changes")}</button><span className="sync-help">{tr("Finds Elvanto People records changed since the last completed sync. Linked updates are checked for local edits; conflicts require your decision.")}</span></div>}
    {status?.configured && directions.people !== "off" && directions.people !== "elvanto_to_smart_church" && <div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void previewPeopleExport()} disabled={busy}><RefreshCw size={15} />{busy ? "Loading preview…" : "Preview People export"}</button><span className="sync-help">Reviews local contacts before creating or updating people in Elvanto. Email matches and missing remote links need review.</span></div>}
    {status?.configured && directions.peopleFlows !== "off" && directions.peopleFlows !== "smart_church_to_elvanto" && <div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void previewPeopleFlows()} disabled={busy}><RefreshCw size={15} />{busy ? "Loading preview…" : "Preview People Flows import"}</button><span className="sync-help">Reads People Flow definitions, steps, instructions, assignments, and statuses. No records are written.</span></div>}
    {status?.configured && directions.groups !== "off" && directions.groups !== "smart_church_to_elvanto" && <div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void previewGroups()} disabled={busy}><RefreshCw size={15} />{busy ? "Loading preview…" : "Preview Groups import"}</button><span className="sync-help">Preview shows up to 50 groups. Same-name groups are skipped for manual resolution.</span></div>}
    {status?.configured && directions.groups !== "off" && directions.groups !== "elvanto_to_smart_church" && <div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void previewGroupsExport()} disabled={busy}><RefreshCw size={15} />{busy ? "Loading preview…" : "Preview Groups export"}</button><span className="sync-help">Reviews local groups and member links before creating or updating Elvanto groups.</span></div>}
    {status?.configured && directions.services !== "off" && directions.services !== "smart_church_to_elvanto" && <div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void previewServices()} disabled={busy}><RefreshCw size={15} />{busy ? "Loading preview…" : "Preview Services import"}</button><span className="sync-help">Previews Elvanto services, service times, plans, and volunteer assignments. Same-title events on the same date are skipped for manual review.</span></div>}
    {status?.configured && directions.calendar !== "off" && directions.calendar !== "smart_church_to_elvanto" && <div className="sync-connection-form"><div className="form-row"><label>Calendar start date<input type="date" value={calendarStartDate} max={calendarEndDate} onChange={(event) => { setCalendarStartDate(event.target.value); setCalendarPreview(null); }} /></label><label>Calendar end date<input type="date" value={calendarEndDate} min={calendarStartDate} onChange={(event) => { setCalendarEndDate(event.target.value); setCalendarPreview(null); }} /></label></div><div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void previewCalendar()} disabled={busy || !calendarStartDate || !calendarEndDate}><RefreshCw size={15} />{busy ? "Loading preview…" : "Preview Calendar import"}</button><span className="sync-help">Choose the date range to import. Elvanto calendar timestamps are returned in UTC.</span></div></div>}
    {status?.configured && directions.calendar !== "off" && directions.calendar !== "elvanto_to_smart_church" && <div className="sync-connection-form"><strong>Export local events to Elvanto</strong><small className="sync-help">Choose the destination calendar and event organizer. Preview maps local event times through this location’s time zone. Exports are private in Elvanto. All-day dates are preserved; multi-day events are not supported by the local schedule yet. Imported Elvanto events and same-title/date conflicts are excluded from writes.</small><div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void loadCalendarExportOptions()} disabled={busy}><RefreshCw size={15} />{calendarExportOptions ? "Refresh calendars and organizers" : "Load calendars and organizers"}</button></div>{calendarExportOptions && <><div className="form-row"><label>Destination calendar<select value={calendarExportCalendarId} onChange={(event) => { setCalendarExportCalendarId(event.target.value); setCalendarExportPreview(null); }}>{calendarExportOptions.calendars.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Organizer<select value={calendarExportOrganizerId} onChange={(event) => { setCalendarExportOrganizerId(event.target.value); setCalendarExportPreview(null); }}>{calendarExportOptions.organizers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label></div>{calendarExportOptions.organizersTotal > calendarExportOptions.organizers.length && <div className="community-inline-actions"><small className="sync-help">Loaded {calendarExportOptions.organizers.length} of {calendarExportOptions.organizersTotal} people.</small><button className="button button-secondary" type="button" onClick={() => void loadCalendarExportOptions(calendarExportOptions.organizersPage + 1)} disabled={busy}>Load more people</button></div>}<div className="form-row"><label>Export events from<input type="date" value={calendarExportStartDate} max={calendarExportEndDate} onChange={(event) => { setCalendarExportStartDate(event.target.value); setCalendarExportPreview(null); }} /></label><label>Through<input type="date" value={calendarExportEndDate} min={calendarExportStartDate} onChange={(event) => { setCalendarExportEndDate(event.target.value); setCalendarExportPreview(null); }} /></label></div><div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void previewCalendarExport()} disabled={busy || !calendarExportCalendarId || !calendarExportOrganizerId || !calendarExportStartDate || !calendarExportEndDate}><RefreshCw size={15} />{busy ? "Loading preview…" : "Preview Calendar export"}</button></div></>}</div>}
    {status?.configured && status.financialEnabled && directions.financial !== "off" && directions.financial !== "smart_church_to_elvanto" && <div className="sync-connection-form"><strong>Financial and giving records</strong><small className="sync-help">Financial data is limited to authorized site administrators. Select the full date range you need; donor and payment details are encrypted in storage.</small><div className="form-row"><label>Giving start date<input type="date" value={financialStartDate} max={financialEndDate || undefined} onChange={(event) => { setFinancialStartDate(event.target.value); setFinancialPreview(null); }} /></label><label>Giving end date<input type="date" value={financialEndDate} min={financialStartDate || undefined} onChange={(event) => { setFinancialEndDate(event.target.value); setFinancialPreview(null); }} /></label></div><div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void previewFinancial()} disabled={busy || !financialStartDate || !financialEndDate}><RefreshCw size={15} />{busy ? "Loading preview…" : "Preview giving import"}</button><span className="sync-help">Reads transaction dates and totals for review; no records are written.</span></div></div>}
    {status?.configured && status.financialImport && <div className="sync-feedback" aria-live="polite"><strong>Giving import progress</strong><span>{status.financialImport.complete ? "Complete" : <>Next batch: {status.financialImport.page}</>}{status.financialImport.total !== null && <> · {status.financialImport.total} transactions</>} · {status.financialImport.created} imported · {status.financialImport.updated} refreshed · {status.financialImport.skipped} skipped {status.financialImport.startDate && status.financialImport.endDate ? `· ${status.financialImport.startDate} – ${status.financialImport.endDate}` : ""}</span></div>}
    {financialPreview && <div className="sync-connection-form" aria-live="polite"><div className="sync-feedback"><strong>Giving import preview</strong><span>{financialPreview.transactionCount} transactions scanned of {financialPreview.reportedTotal} reported by Elvanto{!financialPreview.complete && <em> — preview is incomplete</em>}</span></div><div className="sync-feedback"><span>{financialPreview.createCount} new</span> · <span>{financialPreview.updateCount} will refresh</span></div>{financialPreview.sample.slice(0, 20).map((item, index) => <div className="sync-feedback" key={`${item.date}-${index}`}><strong>{item.date}</strong><span>{item.total} · {item.action === "update" ? "Refresh" : "New"}</span></div>)}<small className="sync-help">Donor names, contact details, and payment information are encrypted at rest and visible only to site administrators when financial access is enabled.</small><div className="community-inline-actions"><button className="button button-primary" type="button" onClick={() => void importFinancial()} disabled={busy || !financialPreview.complete || financialPreview.transactionCount === 0}><Check size={15} />{busy ? "Importing…" : status?.financialImport?.complete ? "Refresh giving records" : status?.financialImport ? "Continue giving import" : "Import giving records"}</button></div></div>}
    {status?.configured && status.financialEnabled && status.financialImport && <button className="button button-secondary" type="button" onClick={() => void loadFinancialTransactions()} disabled={busy}>Browse imported giving records</button>}
    {status?.configured && status.financialEnabled && financialTransactions.length > 0 && <div className="sync-connection-form"><strong>Imported giving records ({financialTransactions.length} of {financialTotal})</strong>{financialTransactions.map((item) => <div className="sync-feedback" key={item.sourceId}><strong>{item.date}</strong><span>{String(item.total)} <button className="button button-secondary" type="button" onClick={() => void viewFinancialTransaction(item.sourceId)} disabled={busy}>View</button></span></div>)}{financialTransactions.length < financialTotal && <button className="button button-secondary" type="button" onClick={() => void loadFinancialTransactions(financialTransactions.length, true)} disabled={busy}>Load more giving records</button>}</div>}
    {financialDetail && <div className="sync-connection-form" aria-live="polite"><h3>Giving record · {financialDetail.date}</h3><small className="sync-help">Imported {new Date(financialDetail.importedAt).toLocaleString()}</small><pre className="sync-song-json">{JSON.stringify(financialDetail.transaction, null, 2)}</pre></div>}
    {status?.configured && directions.songs !== "off" && directions.songs !== "smart_church_to_elvanto" && <div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void previewSongs()} disabled={busy}><RefreshCw size={15} />{busy ? "Loading preview…" : "Preview Songs import"}</button><span className="sync-help">Reads songs, arrangements, keys, lyrics, and chord charts. No records are written.</span></div>}
    {status?.configured && directions.songs !== "off" && directions.songs !== "elvanto_to_smart_church" && <div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void previewSongsExport()} disabled={busy}><RefreshCw size={15} />{busy ? "Loading preview…" : "Preview Songs export"}</button><span className="sync-help">Reviews local songs and arrangements before writing. Author, note, chart-link, and audio-link fields are not accepted by Elvanto’s documented song API.</span></div>}
    {status?.configured && status.songsImport && <div className="sync-feedback" aria-live="polite"><strong>Songs import progress</strong><span>{status.songsImport.complete ? "Complete" : <>Next song: {status.songsImport.page}</>}{status.songsImport.total !== null && <> · {status.songsImport.total} songs</>} · {status.songsImport.created} created · {status.songsImport.updated} refreshed</span></div>}
    {status?.configured && status.songsExport && <div className="sync-feedback" aria-live="polite"><strong>Songs export progress</strong><span>{status.songsExport.complete ? "Complete" : <>Next song: {status.songsExport.page + 1}</>} of {status.songsExport.total} · {status.songsExport.created} created · {status.songsExport.updated} updated · {status.songsExport.skipped} needing review</span>{!songsExportPreview && !status.songsExport.complete && status.songsExport.previewAt && <button className="button button-secondary" type="button" onClick={() => void exportSongs()} disabled={busy}>Continue Songs export</button>}</div>}
    {songsExportPreview && <div className="sync-connection-form" aria-live="polite"><div className="sync-feedback"><strong>Songs export preview</strong><span>{songsExportPreview.total} local songs · {songsExportPreview.create} new · {songsExportPreview.update} updates · {songsExportPreview.unchanged} unchanged · {songsExportPreview.review} needing review</span></div>{songsExportPreview.sample.map((song, index) => <div className="sync-feedback" key={song.title + index}><strong>{song.title}</strong><span>{song.arrangements} arrangements · {song.action.replaceAll("_", " ")}</span></div>)}<small className="sync-help">Only titles, arrangement names, and keys are sent. Authors, notes, licensed chart/audio links, and lyrics are not sent because this export does not retrieve or transfer licensed content. The export is resumable; songs changed after preview require a fresh review.</small><div className="community-inline-actions"><button className="button button-primary" type="button" onClick={() => void exportSongs()} disabled={busy || !songsExportPreview.complete || songsExportPreview.create + songsExportPreview.update === 0}><Check size={15} />{busy ? "Exporting…" : status?.songsExport && !status.songsExport.complete ? "Continue Songs export" : "Export Songs to Elvanto"}</button></div></div>}
    {status?.configured && status.songs?.length > 0 && <div className="sync-connection-form"><strong>Imported Songs</strong>{status.songs.map((song) => <div className="sync-feedback" key={song.sourceId}><strong>{song.title}</strong><span>{song.arrangements} arrangements <button className="button button-secondary" type="button" onClick={() => void viewSong(song.sourceId)} disabled={busy}>View</button></span></div>)}{status.songs.length < status.songsTotal && <button className="button button-secondary" type="button" onClick={() => void loadMoreSongs()} disabled={busy}>Load more songs ({status.songs.length} of {status.songsTotal})</button>}</div>}
    {songDetail && <div className="sync-connection-form" aria-live="polite"><h3>{songDetail.title}</h3><small className="sync-help">Imported {new Date(songDetail.importedAt).toLocaleString()}</small><strong>Song details</strong><pre className="sync-song-json">{JSON.stringify(songDetail.song, null, 2)}</pre><strong>Arrangements, keys, lyrics, and charts</strong>{songDetail.arrangements.map((arrangement, index) => <div className="sync-feedback" key={String(arrangement.id ?? index)}><strong>{String(arrangement.name ?? arrangement.title ?? `Arrangement ${index + 1}`)}</strong><pre className="sync-song-json">{JSON.stringify(arrangement, null, 2)}</pre></div>)}</div>}
    {songsPreview && <div className="sync-connection-form" aria-live="polite"><div className="sync-feedback"><strong>Songs import preview</strong><span>{songsPreview.songCount} songs scanned of {songsPreview.reportedSongCount} reported by Elvanto{!songsPreview.complete && <em> — preview is incomplete</em>}</span></div><div className="sync-feedback"><span>{songsPreview.createCount} new songs</span> · <span>{songsPreview.updateCount} songs will refresh</span></div>{songsPreview.sample.map((song) => <div className="sync-feedback" key={song.title}><strong>{song.title}</strong><span>{song.action === "update" ? "Refresh" : "New"}</span></div>)}<small className="sync-help">Imports five songs at a time, including all arrangements and keys. Imported snapshots are read-only and are not deleted when absent from Elvanto.</small><div className="community-inline-actions"><button className="button button-primary" type="button" onClick={() => void importSongs()} disabled={busy || !songsPreview.complete || songsPreview.songCount === 0}><Check size={15} />{busy ? "Importing…" : status?.songsImport?.complete ? "Refresh Songs from Elvanto" : status?.songsImport ? "Continue Songs import" : "Import Songs"}</button></div></div>}
    {status?.configured && status.songsImport?.complete && directions.songs !== "off" && directions.songs !== "smart_church_to_elvanto" && <ElvantoSongLibraryImport departmentId={departmentId} />}
    {status?.configured && status.peopleImport && <div className="sync-feedback" aria-live="polite"><strong>People import progress</strong><span>{status.peopleImport.complete ? "Complete" : <>Next Elvanto page: {status.peopleImport.page}</>}{status.peopleImport.total !== null && <> · {status.peopleImport.total} records</>} · {status.peopleImport.created} created · {status.peopleImport.updated} updated · {status.peopleImport.skipped} skipped</span></div>}
    {status?.peopleIncremental && <div className="sync-feedback" aria-live="polite"><strong>{tr("Incremental People sync")}</strong><span>{status.peopleIncremental.complete ? tr("Last change batch complete") : `${status.peopleIncremental.processed} / ${status.peopleIncremental.total}`} · {status.peopleIncremental.created} {tr("created")} · {status.peopleIncremental.updated} {tr("updated")} · {status.peopleIncremental.skipped} {tr("skipped")} · {status.peopleIncremental.review} {tr("needing review")}</span>{!status.peopleIncremental.complete && status.peopleIncremental.previewId && <button className="button button-secondary" type="button" onClick={() => void importIncrementalPeople()} disabled={busy}><Check size={15} />{busy ? tr("Applying batch…") : tr("Continue incremental sync")}</button>}</div>}
    {status?.configured && status.peopleFlowsImport && <div className="sync-feedback" aria-live="polite"><strong>People Flows import progress</strong><span>{status.peopleFlowsImport.complete ? "Complete" : <>Next batch: {status.peopleFlowsImport.page}</>}{status.peopleFlowsImport.total !== null && <> · {status.peopleFlowsImport.total} flows</>} · {status.peopleFlowsImport.created} created · {status.peopleFlowsImport.updated} updated · {status.peopleFlowsImport.skipped} skipped</span></div>}
    {status?.configured && status.peopleFlows?.length > 0 && <div className="sync-connection-form"><strong>Imported People Flows</strong>{status.peopleFlows.map((flow) => <div className="sync-feedback" key={flow.sourceId}><strong>{flow.name}</strong><span>{flow.steps} steps · {flow.members} assignments <button className="button button-secondary" type="button" onClick={() => void viewPeopleFlow(flow.sourceId)} disabled={busy}>View</button></span></div>)}</div>}
    {peopleFlowDetail && <div className="sync-connection-form" aria-live="polite"><h3>{peopleFlowDetail.name}</h3><small className="sync-help">Imported {new Date(peopleFlowDetail.importedAt).toLocaleString()}</small><strong>Steps and instructions</strong>{peopleFlowDetail.definition.steps.map((step) => <div className="sync-feedback" key={step.id}><strong>{step.name}</strong>{step.description && <span>{step.description}</span>}{step.instructions && <small>{step.instructions}</small>}{typeof step.due.days === "number" || typeof step.due.days === "string" ? <small className="sync-help">Due after {String(step.due.days)} {String(step.due.type ?? "days")}</small> : null}</div>)}<strong>Assignments ({peopleFlowDetail.members.length} of {peopleFlowDetail.memberTotal})</strong>{peopleFlowDetail.members.map((member, index) => <div className="sync-feedback" key={`${member.stepId}-${member.personId}-${index}`}><strong>{member.contactName || `Elvanto person ${member.personId}`}</strong><span>{member.stepName} · {member.status || "Not started"}{member.dueDate ? ` · due ${member.dueDate}` : ""}{member.assignedAdminId ? ` · assigned to ${member.assignedAdminId}` : ""}{member.completedDate ? ` · completed ${member.completedDate}` : ""}{member.completedBy ? ` · completed by ${member.completedBy}` : ""}</span></div>)}{peopleFlowDetail.members.length < peopleFlowDetail.memberTotal && <button className="button button-secondary" type="button" onClick={() => void loadMorePeopleFlowAssignments()} disabled={busy}>Load more assignments</button>}</div>}
    {status?.configured && status.groupsImport && <div className="sync-feedback" aria-live="polite"><strong>Groups import progress</strong><span>{status.groupsImport.complete ? "Complete" : <>Next Elvanto page: {status.groupsImport.page}</>}{status.groupsImport.total !== null && <> · {status.groupsImport.total} groups</>} · {status.groupsImport.created} created · {status.groupsImport.updated} updated · {status.groupsImport.skipped} skipped</span></div>}
    {status?.configured && status.servicesImport && <div className="sync-feedback" aria-live="polite"><strong>Services import progress</strong><span>{status.servicesImport.complete ? "Complete" : <>Next Elvanto page: {status.servicesImport.page}</>}{status.servicesImport.total !== null && <> · {status.servicesImport.total} Elvanto services</>} · {status.servicesImport.created} events created · {status.servicesImport.updated} updated · {status.servicesImport.skipped} skipped</span></div>}
    {status?.configured && syncAudit.length > 0 && <div className="sync-connection-form" aria-label={tr("Recent sync activity")}><strong>{tr("Recent sync activity")}</strong>{syncAudit.map((entry, index) => <div className="sync-feedback" key={`${entry.createdAt}-${entry.area}-${entry.action}-${index}`}><span>{new Date(entry.createdAt).toLocaleString()} · {tr(entry.area === "peopleFlows" ? "people flows" : entry.area)} · {tr(entry.action.replaceAll("_", " "))} · {tr(entry.outcome)}</span><small>{Object.entries(entry.summary).filter(([key]) => key !== "incremental" && key !== "complete").map(([key, value]) => `${typeof value === "boolean" ? (value ? tr("complete") : "") : value} ${tr(key)}`).filter(Boolean).join(" · ")}</small></div>)}</div>}
    {status?.configured && status.calendarImport && <div className="sync-feedback" aria-live="polite"><strong>Calendar import progress</strong><span>{status.calendarImport.startDate && status.calendarImport.endDate ? `${status.calendarImport.startDate} – ${status.calendarImport.endDate} · ` : ""}{status.calendarImport.complete ? "Complete" : <>Next Elvanto page: {status.calendarImport.page}</>}{status.calendarImport.total !== null && <> · {status.calendarImport.total} events</>} · {status.calendarImport.created} created · {status.calendarImport.updated} updated · {status.calendarImport.skipped} skipped</span></div>}
    {status?.configured && status.calendarExport && <div className="sync-feedback" aria-live="polite"><strong>Calendar export progress</strong><span>{status.calendarExport.complete ? "Complete" : <>Next event: {status.calendarExport.page + 1}</>} of {status.calendarExport.total} · {status.calendarExport.created} created · {status.calendarExport.updated} updated · {status.calendarExport.skipped} needing review</span>{!status.calendarExport.complete && status.calendarExport.previewAt && <button className="button button-secondary" type="button" onClick={() => void exportCalendar()} disabled={busy}>Continue Calendar export</button>}</div>}
    {permissionChecks && <div className="sync-connection-form" aria-live="polite">{permissionChecks.map((check) => <div className="sync-feedback" key={check.area}><span className={check.accessible ? "event-kind event-kind-service" : "event-kind event-kind-other"}>{check.accessible ? "Read access confirmed" : "Read access failed"}</span><strong>{areas.find(({ id }) => id === check.area)?.label}</strong>{typeof check.recordCount === "number" && <span>{check.recordCount} records</span>}{check.detail && <small>{check.detail}</small>}</div>)}</div>}
    {peoplePreview && <div className="sync-connection-form" aria-live="polite">
      <div className="sync-feedback"><strong>People import preview</strong><span>{peoplePreview.scannedCount} scanned{peoplePreview.reportedTotal !== null && <> of {peoplePreview.reportedTotal} reported by Elvanto</>} · {peoplePreview.customFieldCount} custom fields included{!peoplePreview.complete && <em> — preview is incomplete</em>}</span></div>
      <div className="sync-feedback"><span>{peoplePreview.createCount} new</span> · <span>{peoplePreview.alreadyLinkedCount} already linked</span> · <span>{peoplePreview.emailMatchCount} email matches needing review</span> · <span>{peoplePreview.ambiguousEmailCount} ambiguous email matches</span> · <span>{peoplePreview.invalidCount} records needing review</span></div>
      {peoplePreview.sample.map((person, index) => <div className="sync-feedback" key={`${person.email ?? person.firstName}-${index}`}><strong>{person.firstName} {person.lastName}</strong><span>{person.email || "No email"} · {person.action === "already_linked" ? "Already linked" : person.action === "review_email_match" ? "Review email match" : person.action === "review_ambiguous_email" ? "Review ambiguous email match" : person.action === "needs_review" ? "Needs review" : person.action === "duplicate_source_id" ? "Duplicate Elvanto ID" : "New contact"}</span></div>)}
      <small className="sync-help">Email matches are shown for review only. They will not be merged automatically.</small>
      <div className="community-inline-actions"><button className="button button-primary" type="button" onClick={() => void importPeople()} disabled={busy || !peoplePreview.complete || (peoplePreview.createCount + peoplePreview.alreadyLinkedCount === 0)}><Check size={15} />{busy ? "Importing…" : status?.peopleImport?.complete ? "Refresh People from Elvanto" : status?.peopleImport ? "Continue People import" : "Import eligible contacts"}</button><span className="sync-help">Requires a complete preview. Work advances five Elvanto pages per batch; email matches are skipped for manual resolution.</span></div>
    </div>}
    {incrementalPeoplePreview && <div className="sync-connection-form" aria-live="polite">
      <div className="sync-feedback"><strong>{tr("Incremental People preview")}</strong><span>{incrementalPeoplePreview.scannedCount} {tr("changed records scanned")}{incrementalPeoplePreview.reportedTotal !== null && <> · {incrementalPeoplePreview.reportedTotal} {tr("reported by Elvanto")}</>} · {incrementalPeoplePreview.createCount} {tr("new")} · {incrementalPeoplePreview.updateCount} {tr("safe updates")} · {incrementalPeoplePreview.conflictCount} {tr("linked conflicts")} · {incrementalPeoplePreview.reviewCount} {tr("needing review")}{!incrementalPeoplePreview.complete && <em> — {tr("preview is incomplete")}</em>}</span></div>
      <small className="sync-help">{tr("Change window starts {date} and advances only after all batches finish. People absent from Elvanto are never deleted.").replace("{date}", new Date(incrementalPeoplePreview.cursorFrom).toLocaleString())}</small>
      {incrementalPeopleRows.map((person) => <div className="sync-feedback" key={person.sourceId}>
        <strong>{String(person.remote.firstName ?? "")} {String(person.remote.lastName ?? "")} · {incrementalActionLabel(person.action)}</strong>
        <span>{String(person.remote.email ?? tr("No email"))} · {String(person.remote.phone ?? tr("No phone"))} · ID {person.sourceId}{person.modifiedAt ? ` · ${tr("changed on {date}").replace("{date}", new Date(person.modifiedAt).toLocaleString())}` : ""}</span>
        {person.local && <small className="sync-help">{tr("Local: {firstName} {lastName} · {email}").replace("{firstName}", String(person.local.firstName ?? "")).replace("{lastName}", String(person.local.lastName ?? "")).replace("{email}", String(person.local.email ?? "No email"))}</small>}
        {person.candidates?.map((candidate, index) => <small className="sync-help" key={`${person.sourceId}-match-${index}`}>{tr("Email match: {firstName} {lastName} · {email}").replace("{firstName}", String(candidate.firstName ?? "")).replace("{lastName}", String(candidate.lastName ?? "")).replace("{email}", String(candidate.email ?? ""))}</small>)}
        {(person.action === "conflict" || ["review_email_match", "invalid", "duplicate"].includes(person.action)) && <label>{tr("Review decision")}<select value={person.resolution ?? ""} disabled={busy} onChange={(event) => event.target.value && void resolveIncrementalPerson(person.sourceId, event.target.value as "use_elvanto" | "keep_local" | "skip")}><option value="">{tr("Choose a decision")}</option>{person.action === "conflict" ? <><option value="use_elvanto">{tr("Use Elvanto values")}</option><option value="keep_local">{tr("Keep local values")}</option></> : null}<option value="skip">{tr("Skip this record")}</option></select></label>}
      </div>)}
      <div className="community-inline-actions"><button className="button button-secondary" type="button" disabled={busy || incrementalPeopleOffset <= 0} onClick={() => void loadIncrementalPeopleRows(incrementalPeoplePreview.previewId, Math.max(0, incrementalPeopleOffset - 50))}>{tr("Previous")}</button><span className="sync-help">{tr("Showing {from}–{to} of {total}").replace("{from}", incrementalPeopleRows.length ? String(incrementalPeopleOffset + 1) : "0").replace("{to}", String(Math.min(incrementalPeopleOffset + incrementalPeopleRows.length, incrementalPeopleTotal))).replace("{total}", String(incrementalPeopleTotal))}</span><button className="button button-secondary" type="button" disabled={busy || incrementalPeopleOffset + 50 >= incrementalPeopleTotal} onClick={() => void loadIncrementalPeopleRows(incrementalPeoplePreview.previewId, incrementalPeopleOffset + 50)}>{tr("Next")}</button><button className="button button-primary" type="button" onClick={() => void importIncrementalPeople()} disabled={busy || !incrementalPeoplePreview.complete || incrementalPeoplePreview.reviewCount > 0 || status?.peopleIncremental?.complete === true}><Check size={15} />{busy ? tr("Applying batch…") : tr("Apply reviewed changes")}</button></div>
    </div>}
    {status?.configured && status.peopleExport && <div className="sync-feedback" aria-live="polite"><strong>People export progress</strong><span>{status.peopleExport.complete ? "Complete" : <>Next contact: {status.peopleExport.page + 1}</>} of {status.peopleExport.total} · {status.peopleExport.created} created · {status.peopleExport.updated} updated · {status.peopleExport.skipped} needing review</span>{!peopleExportPreview && !status.peopleExport.complete && status.peopleExport.previewAt && <button className="button button-secondary" type="button" onClick={() => void exportPeople()} disabled={busy}><Check size={15} />{busy ? "Exporting…" : "Continue People export"}</button>}</div>}
    {status?.configured && status.groupsExport && <div className="sync-feedback" aria-live="polite"><strong>Groups export progress</strong><span>{status.groupsExport.complete ? "Complete" : <>Next operation: {status.groupsExport.page + 1}</>} of {status.groupsExport.total} · {status.groupsExport.created} created · {status.groupsExport.updated} updated · {status.groupsExport.addedMembers} members added · {status.groupsExport.skipped} skipped</span>{!groupsExportPreview && !status.groupsExport.complete && status.groupsExport.previewAt && <button className="button button-secondary" type="button" onClick={() => void exportGroups()} disabled={busy}><Check size={15} />{busy ? "Exporting…" : "Continue Groups export"}</button>}</div>}
    {peopleExportPreview && <div className="sync-connection-form" aria-live="polite"><div className="sync-feedback"><strong>People export preview</strong><span>{peopleExportPreview.total} local contacts · {peopleExportPreview.create} new · {peopleExportPreview.update} updates · {peopleExportPreview.review} needing review</span></div>{peopleExportPreview.sample.map((person, index) => <div className="sync-feedback" key={`${person.email ?? person.firstName}-${index}`}><strong>{person.firstName} {person.lastName}</strong><span>{person.email || "No email"} · {person.action.replaceAll("_", " ")}</span></div>)}<small className="sync-help">Only local contacts are sent. Elvanto email matches and contacts missing upstream are not created or changed automatically. Each batch writes at most five records.</small><div className="community-inline-actions"><button className="button button-primary" type="button" onClick={() => void exportPeople()} disabled={busy || !peopleExportPreview.complete || peopleExportPreview.create + peopleExportPreview.update === 0}><Check size={15} />{busy ? "Exporting…" : status?.peopleExport && !status.peopleExport.complete ? "Continue People export" : "Export People to Elvanto"}</button></div></div>}
    {peopleFlowsPreview && <div className="sync-connection-form" aria-live="polite">
      <div className="sync-feedback"><strong>People Flows import preview</strong><span>{peopleFlowsPreview.flowCount} flows scanned of {peopleFlowsPreview.reportedFlowCount} reported by Elvanto · {peopleFlowsPreview.stepCount} steps · {peopleFlowsPreview.assignmentCount} assignments{!peopleFlowsPreview.complete && <em> — preview is incomplete</em>}</span></div>
      <div className="sync-feedback"><span>{peopleFlowsPreview.createCount} new flows</span> · <span>{peopleFlowsPreview.updateCount} already imported and will refresh</span></div>
      {peopleFlowsPreview.sample.map((flow) => <div className="sync-feedback" key={flow.name}><strong>{flow.name}</strong><span>{flow.steps} steps · {flow.assignments} assignments · {flow.action === "update" ? "Refresh" : "New"}</span></div>)}
      <small className="sync-help">Assignments link to stable Elvanto person IDs. Imported flow definitions and assignments are read-only; records absent from Elvanto are not deleted. Continue in batches of five flows.</small>
      <div className="community-inline-actions"><button className="button button-primary" type="button" onClick={() => void importPeopleFlows()} disabled={busy || !peopleFlowsPreview.complete || peopleFlowsPreview.flowCount === 0}><Check size={15} />{busy ? "Importing…" : status?.peopleFlowsImport?.complete ? "Refresh People Flows from Elvanto" : status?.peopleFlowsImport ? "Continue People Flows import" : "Import People Flows"}</button></div>
    </div>}
    {status?.configured && status.peopleFlowsImport?.complete && <ElvantoPeopleFlowCrosswalk departmentId={departmentId} />}
    {groupsPreview && <div className="sync-connection-form" aria-live="polite">
      <div className="sync-feedback"><strong>Groups import preview</strong><span>{groupsPreview.scannedCount} scanned{groupsPreview.reportedTotal !== null && <> of {groupsPreview.reportedTotal} reported by Elvanto</>}{!groupsPreview.complete && <em> — preview is incomplete</em>}</span></div>
      <div className="sync-feedback"><span>{groupsPreview.createCount} {tr("new")} groups</span> · <span>{groupsPreview.updateCount} {tr("groups to update")}</span> · <span>{groupsPreview.alreadyLinkedCount} {tr("unchanged")} groups</span> · <span>{groupsPreview.memberAddCount} {tr("members to add")}</span> · <span>{groupsPreview.nameConflictCount} name conflicts to review</span> · <span>{groupsPreview.invalidCount} invalid groups</span></div>
      <div className="sync-feedback"><span>{groupsPreview.memberCount} member assignments found</span> · <span>{groupsPreview.linkedMemberCount} members linked to Elvanto people</span> · <span>{groupsPreview.unmatchedMemberCount} members need the People import first</span> · <span>{groupsPreview.localOnlyMemberCount} local-only memberships will be kept</span></div>
      {groupsPreview.sample.map((group, index) => <div className="sync-feedback" key={`${group.name}-${index}`}><strong>{group.name}</strong><span>{group.members} members · {group.linkedMembers} linked · {group.membersToAdd} to add · {group.action === "update" ? tr("Update") : group.action === "already_linked" ? tr("Unchanged") : group.action === "review_name_conflict" ? "Review name conflict" : group.action === "needs_review" ? "Needs review" : group.action === "duplicate_source_id" ? "Duplicate Elvanto ID" : "New group"}</span></div>)}
      <small className="sync-help">Requires a complete preview. Work advances five Elvanto pages per batch. Same-name groups are skipped for manual resolution. Refreshes only add or update linked members; local-only memberships are never removed automatically.</small>
      <div className="community-inline-actions"><button className="button button-primary" type="button" onClick={() => void importGroups()} disabled={busy || !groupsPreview.complete || groupsPreview.createCount + groupsPreview.updateCount + groupsPreview.alreadyLinkedCount === 0}><Check size={15} />{busy ? "Importing…" : status?.groupsImport?.complete ? "Refresh Groups from Elvanto" : status?.groupsImport ? "Continue Groups import" : "Import eligible groups"}</button></div>
    </div>}
    {groupsExportPreview && <div className="sync-connection-form" aria-live="polite"><div className="sync-feedback"><strong>Groups export preview</strong><span>{groupsExportPreview.groups} local groups · {groupsExportPreview.create} new · {groupsExportPreview.update} updates · {groupsExportPreview.addMembers} members to add · {groupsExportPreview.review} needing review</span></div><div className="sync-feedback"><span>{groupsExportPreview.missingPeople} active members need a People export first</span> · <span>{groupsExportPreview.remoteOnlyMembers} Elvanto memberships will be kept for review</span></div>{groupsExportPreview.sample.map((group, index) => <div className="sync-feedback" key={`${group.name}-${index}`}><strong>{group.name}</strong><span>{group.action.replaceAll("_", " ")} · {group.membersToAdd} members to add · {group.missingPeople} people not linked · {group.remoteOnlyMembers} remote-only memberships</span></div>)}<small className="sync-help">Only group names and active member links are exported. Member removals are never automatic; Elvanto-only members stay in place for manual review. Writes are resumable in batches of at most five API calls.</small><div className="community-inline-actions"><button className="button button-primary" type="button" onClick={() => void exportGroups()} disabled={busy || !groupsExportPreview.complete || groupsExportPreview.create + groupsExportPreview.update + groupsExportPreview.addMembers === 0}><Check size={15} />{busy ? "Exporting…" : status?.groupsExport && !status.groupsExport.complete ? "Continue Groups export" : "Export Groups to Elvanto"}</button></div></div>}
    {servicesPreview && <div className="sync-connection-form" aria-live="polite">
      <div className="sync-feedback"><strong>Services import preview</strong><span>{servicesPreview.scannedCount} service times scanned{servicesPreview.reportedTotal !== null && <> across {servicesPreview.reportedTotal} Elvanto services</>}{!servicesPreview.complete && <em> — preview is incomplete</em>}</span></div>
      <div className="sync-feedback"><span>{servicesPreview.createCount} {tr("new")}</span> · <span>{servicesPreview.updateCount} {tr("updates")}</span> · <span>{servicesPreview.alreadyLinkedCount} {tr("unchanged")}</span> · <span>{servicesPreview.conflictCount} same-title/date conflicts</span> · <span>{servicesPreview.invalidCount} invalid or duplicate rows</span></div>
      <div className="sync-feedback"><span>{servicesPreview.assignmentCreateCount} new volunteer assignments</span> · <span>{servicesPreview.assignmentChangeCount} assignment changes</span> · <span>{servicesPreview.missingPeopleLinkCount} assignments need People links</span></div>
      {servicesPreview.sample.map((service, index) => <div className="sync-feedback" key={`${service.date}-${service.title}-${index}`}><strong>{service.title}</strong><span>{service.date} · {service.action === "update" ? `${tr("Update")}: ${service.changedFields.map((field) => tr(field)).join(", ")}` : service.action === "already_linked" ? tr("Unchanged") : service.action === "review_event_conflict" ? "Review event conflict" : service.action === "needs_review" ? "Needs review" : service.action === "duplicate_source_id" ? "Duplicate Elvanto ID" : "New service"}</span></div>)}
      <small className="sync-help">Only complete previews can be imported. Each batch advances up to five Elvanto pages. Imported events are read-only and are not deleted when absent from Elvanto.</small>
      <div className="community-inline-actions"><button className="button button-primary" type="button" onClick={() => void importServices()} disabled={busy || !servicesPreview.complete || servicesPreview.createCount + servicesPreview.updateCount + servicesPreview.alreadyLinkedCount === 0}><Check size={15} />{busy ? "Importing…" : status?.servicesImport?.complete ? "Refresh Services from Elvanto" : status?.servicesImport ? "Continue Services import" : "Import eligible services"}</button></div>
    </div>}
    {calendarPreview && <div className="sync-connection-form" aria-live="polite">
      <div className="sync-feedback"><strong>Calendar import preview</strong><span>{calendarPreview.scannedCount} events scanned, {calendarPreview.startDate} – {calendarPreview.endDate}{!calendarPreview.complete && <em> — preview is incomplete</em>}</span></div>
      <div className="sync-feedback"><span>{calendarPreview.createCount} {tr("new")}</span> · <span>{calendarPreview.updateCount} {tr("updates")}</span> · <span>{calendarPreview.alreadyLinkedCount} {tr("unchanged")}</span> · <span>{calendarPreview.conflictCount} same-title/date conflicts</span> · <span>{calendarPreview.invalidCount} invalid or duplicate rows</span></div>
      {calendarPreview.sample.map((event, index) => <div className="sync-feedback" key={`${event.date}-${event.title}-${index}`}><strong>{event.title}</strong><span>{event.date} · {event.action === "update" ? `${tr("Update")}: ${event.changedFields.map((field) => tr(field)).join(", ")}` : event.action === "already_linked" ? tr("Unchanged") : event.action === "review_event_conflict" ? "Review event conflict" : event.action === "needs_review" ? "Needs review" : event.action === "duplicate_source_id" ? "Duplicate Elvanto ID" : "New event"}</span></div>)}
      <small className="sync-help">Only the selected date range is imported. All-day items retain their date; multi-day calendar records are not supported.</small>
      <div className="community-inline-actions"><button className="button button-primary" type="button" onClick={() => void importCalendar()} disabled={busy || !calendarPreview.complete || calendarPreview.createCount + calendarPreview.updateCount + calendarPreview.alreadyLinkedCount === 0}><Check size={15} />{busy ? "Importing…" : status?.calendarImport?.complete ? "Refresh Calendar from Elvanto" : status?.calendarImport ? "Continue Calendar import" : "Import eligible calendar events"}</button></div>
    </div>}
    {calendarExportPreview && <div className="sync-connection-form" aria-live="polite"><div className="sync-feedback"><strong>Calendar export preview</strong><span>{calendarExportPreview.startDate} – {calendarExportPreview.endDate} · {calendarExportPreview.total} local events · {calendarExportPreview.create} new · {calendarExportPreview.update} updates · {calendarExportPreview.review} needing review · {calendarExportPreview.timeZone}</span><small>Destination: {calendarExportPreview.calendar.name} · Organizer: {calendarExportPreview.organizer.name}</small></div>{calendarExportPreview.sample.map((event, index) => <div className="sync-feedback" key={`${event.date}-${event.title}-${index}`}><strong>{event.title}</strong><span>{event.date} · {event.isAllDay ? "All day" : `${event.start ?? "Invalid time"}–${event.end ?? "—"} UTC`} · {event.action.replaceAll("_", " ")}</span></div>)}<small className="sync-help">Only complete previews can be written. Creates and updates run in batches of at most five. Events imported from Elvanto are never sent back, and remote events are never deleted.</small><div className="community-inline-actions"><button className="button button-primary" type="button" onClick={() => void exportCalendar()} disabled={busy || !calendarExportPreview.complete || calendarExportPreview.create + calendarExportPreview.update === 0}><Check size={15} />{busy ? "Exporting…" : status?.calendarExport && !status.calendarExport.complete ? "Continue Calendar export" : "Export Calendar to Elvanto"}</button></div></div>}
    {feedback && <p className="sync-feedback" role="status"><Link2 size={15} />{feedback}</p>}
    {error && <p className="sync-feedback sync-feedback-error" role="alert"><CircleAlert size={15} />{error}</p>}
  </section>;
}
