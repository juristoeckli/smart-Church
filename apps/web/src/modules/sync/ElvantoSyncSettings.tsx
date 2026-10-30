import { useEffect, useState, type FormEvent } from "react";
import { Check, CircleAlert, Link2, RefreshCw, Unplug } from "lucide-react";

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
type PeopleExportPreview = { complete: boolean; total: number; create: number; update: number; review: number; sample: Array<{ firstName: string; lastName: string; email: string | null; action: string }> };
type GroupsPreview = {
  scannedCount: number; reportedTotal: number | null; complete: boolean;
  createCount: number; alreadyLinkedCount: number; nameConflictCount: number; invalidCount: number;
  memberCount: number; linkedMemberCount: number; unmatchedMemberCount: number;
  sample: Array<{ name: string; action: string; members: number; linkedMembers: number }>;
};
type ServicesPreview = {
  scannedCount: number; reportedTotal: number | null; complete: boolean;
  createCount: number; alreadyLinkedCount: number; conflictCount: number; invalidCount: number;
  sample: Array<{ title: string; date: string; action: string }>;
};
type CalendarPreview = {
  scannedCount: number; reportedTotal: number | null; complete: boolean; startDate: string; endDate: string;
  createCount: number; alreadyLinkedCount: number; conflictCount: number; invalidCount: number;
  sample: Array<{ title: string; date: string; action: string }>;
};
type PeopleFlowsPreview = {
  flowCount: number; reportedFlowCount: number; stepCount: number; assignmentCount: number; complete: boolean;
  createCount: number; updateCount: number;
  sample: Array<{ name: string; steps: number; assignments: number; action: string }>;
};
type PeopleFlowsImportProgress = ImportProgress & { lastImportAt: string | null };
type SongsPreview = { songCount: number; reportedSongCount: number; complete: boolean; createCount: number; updateCount: number; sample: Array<{ title: string; arrangements: number; action: string }> };
type SongsImportProgress = ImportProgress & { previewComplete: boolean; previewCount: number; importedCount: number; lastImportAt: string | null };
type FinancialPreview = { transactionCount: number; reportedTotal: number; complete: boolean; createCount: number; updateCount: number; sample: Array<{ date: string; total: string; action: string }> };
type FinancialItem = { sourceId: string; date: string; total: string | number; importedAt: string };
type FinancialDetail = { sourceId: string; date: string; transaction: Record<string, unknown>; importedAt: string };
type FinancialImportProgress = ImportProgress & { previewComplete: boolean; previewCount: number; startDate: string | null; endDate: string | null };
type ImportedSong = { sourceId: string; title: string; arrangements: number; importedAt: string };
type SongDetail = { sourceId: string; title: string; song: Record<string, unknown>; arrangements: Array<Record<string, unknown>>; importedAt: string };
type ImportedPeopleFlow = { sourceId: string; name: string; steps: number; members: number; importedAt: string };
type PeopleFlowDetail = { sourceId: string; name: string; definition: { steps: Array<{ id: string; parentStepId: string | null; name: string; description: string; instructions: string; priority: string; due: Record<string, unknown>; admins: Array<{ id: string; role: string }> }> }; members: Array<{ stepId: string; stepName: string; personId: string; status: string; assignedAdminId: string; dueDate: string; completedDate: string; completedBy: string; contactId: string | null; contactName: string | null }>; memberOffset: number; memberTotal: number; importedAt: string };
type Status = { configured: boolean; directions: Directions; financialEnabled: boolean; lastConnectedAt: string | null; lastSyncAt: string | null; lastSyncError: string | null; peopleImport: ImportProgress | null; peopleExport: (ImportProgress & { previewAt: string | null }) | null; peopleFlowsImport: PeopleFlowsImportProgress | null; peopleFlows: ImportedPeopleFlow[]; songsImport: SongsImportProgress | null; songs: ImportedSong[]; songsTotal: number; financialImport: FinancialImportProgress | null; groupsImport: ImportProgress | null; servicesImport: ImportProgress | null; calendarImport: (ImportProgress & { startDate: string | null; endDate: string | null }) | null };

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
  const [peopleExportPreview, setPeopleExportPreview] = useState<PeopleExportPreview | null>(null);
  const [groupsPreview, setGroupsPreview] = useState<GroupsPreview | null>(null);
  const [servicesPreview, setServicesPreview] = useState<ServicesPreview | null>(null);
  const [calendarStartDate, setCalendarStartDate] = useState(() => shiftUtcYear(-5));
  const [calendarEndDate, setCalendarEndDate] = useState(() => shiftUtcYear(5));
  const [calendarPreview, setCalendarPreview] = useState<CalendarPreview | null>(null);
  const [peopleFlowsPreview, setPeopleFlowsPreview] = useState<PeopleFlowsPreview | null>(null);
  const [peopleFlowDetail, setPeopleFlowDetail] = useState<PeopleFlowDetail | null>(null);
  const [songsPreview, setSongsPreview] = useState<SongsPreview | null>(null);
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
    if (!peopleExportPreview?.complete || peopleExportPreview.create + peopleExportPreview.update <= 0) return;
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
    if (!servicesPreview?.complete || servicesPreview.createCount + servicesPreview.alreadyLinkedCount <= 0) return;
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
    if (!calendarPreview?.complete || calendarPreview.createCount + calendarPreview.alreadyLinkedCount <= 0) return;
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

  return <section className="directory-card sync-settings-card elvanto-settings-card">
    <div className="directory-heading"><div><h2>Elvanto</h2><p>{status?.configured ? "Connection verified" : "Connect this location to Elvanto."}</p></div>{status?.configured && <span className="event-kind event-kind-service">Connected</span>}</div>
    <div className="demo-notice demo-notice-error"><span className="demo-dot" /><span>People supports reviewed, resumable imports and exports. People Flows, Groups, Services, Songs, Calendar, and giving currently have one-way imports.</span> <span>Other reverse-direction sync and bidirectional conflict handling remain under development.</span></div>
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
    {status?.configured && directions.people !== "off" && directions.people !== "elvanto_to_smart_church" && <div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void previewPeopleExport()} disabled={busy}><RefreshCw size={15} />{busy ? "Loading preview…" : "Preview People export"}</button><span className="sync-help">Reviews local contacts before creating or updating people in Elvanto. Email matches and missing remote links need review.</span></div>}
    {status?.configured && directions.peopleFlows !== "off" && directions.peopleFlows !== "smart_church_to_elvanto" && <div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void previewPeopleFlows()} disabled={busy}><RefreshCw size={15} />{busy ? "Loading preview…" : "Preview People Flows import"}</button><span className="sync-help">Reads People Flow definitions, steps, instructions, assignments, and statuses. No records are written.</span></div>}
    {status?.configured && directions.groups !== "off" && directions.groups !== "smart_church_to_elvanto" && <div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void previewGroups()} disabled={busy}><RefreshCw size={15} />{busy ? "Loading preview…" : "Preview Groups import"}</button><span className="sync-help">Preview shows up to 50 groups. Existing Elvanto groups will refresh; only memberships for imported groups are replaced.</span></div>}
    {status?.configured && directions.services !== "off" && directions.services !== "smart_church_to_elvanto" && <div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void previewServices()} disabled={busy}><RefreshCw size={15} />{busy ? "Loading preview…" : "Preview Services import"}</button><span className="sync-help">Previews Elvanto services, service times, plans, and volunteer assignments. Same-title events on the same date are skipped for manual review.</span></div>}
    {status?.configured && directions.calendar !== "off" && directions.calendar !== "smart_church_to_elvanto" && <div className="sync-connection-form"><div className="form-row"><label>Calendar start date<input type="date" value={calendarStartDate} max={calendarEndDate} onChange={(event) => { setCalendarStartDate(event.target.value); setCalendarPreview(null); }} /></label><label>Calendar end date<input type="date" value={calendarEndDate} min={calendarStartDate} onChange={(event) => { setCalendarEndDate(event.target.value); setCalendarPreview(null); }} /></label></div><div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void previewCalendar()} disabled={busy || !calendarStartDate || !calendarEndDate}><RefreshCw size={15} />{busy ? "Loading preview…" : "Preview Calendar import"}</button><span className="sync-help">Choose the date range to import. Elvanto calendar timestamps are returned in UTC.</span></div></div>}
    {status?.configured && status.financialEnabled && directions.financial !== "off" && directions.financial !== "smart_church_to_elvanto" && <div className="sync-connection-form"><strong>Financial and giving records</strong><small className="sync-help">Financial data is limited to authorized site administrators. Select the full date range you need; donor and payment details are encrypted in storage.</small><div className="form-row"><label>Giving start date<input type="date" value={financialStartDate} max={financialEndDate || undefined} onChange={(event) => { setFinancialStartDate(event.target.value); setFinancialPreview(null); }} /></label><label>Giving end date<input type="date" value={financialEndDate} min={financialStartDate || undefined} onChange={(event) => { setFinancialEndDate(event.target.value); setFinancialPreview(null); }} /></label></div><div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void previewFinancial()} disabled={busy || !financialStartDate || !financialEndDate}><RefreshCw size={15} />{busy ? "Loading preview…" : "Preview giving import"}</button><span className="sync-help">Reads transaction dates and totals for review; no records are written.</span></div></div>}
    {status?.configured && status.financialImport && <div className="sync-feedback" aria-live="polite"><strong>Giving import progress</strong><span>{status.financialImport.complete ? "Complete" : <>Next batch: {status.financialImport.page}</>}{status.financialImport.total !== null && <> · {status.financialImport.total} transactions</>} · {status.financialImport.created} imported · {status.financialImport.updated} refreshed · {status.financialImport.skipped} skipped {status.financialImport.startDate && status.financialImport.endDate ? `· ${status.financialImport.startDate} – ${status.financialImport.endDate}` : ""}</span></div>}
    {financialPreview && <div className="sync-connection-form" aria-live="polite"><div className="sync-feedback"><strong>Giving import preview</strong><span>{financialPreview.transactionCount} transactions scanned of {financialPreview.reportedTotal} reported by Elvanto{!financialPreview.complete && <em> — preview is incomplete</em>}</span></div><div className="sync-feedback"><span>{financialPreview.createCount} new</span> · <span>{financialPreview.updateCount} will refresh</span></div>{financialPreview.sample.slice(0, 20).map((item, index) => <div className="sync-feedback" key={`${item.date}-${index}`}><strong>{item.date}</strong><span>{item.total} · {item.action === "update" ? "Refresh" : "New"}</span></div>)}<small className="sync-help">Donor names, contact details, and payment information are encrypted at rest and visible only to site administrators when financial access is enabled.</small><div className="community-inline-actions"><button className="button button-primary" type="button" onClick={() => void importFinancial()} disabled={busy || !financialPreview.complete || financialPreview.transactionCount === 0}><Check size={15} />{busy ? "Importing…" : status?.financialImport?.complete ? "Refresh giving records" : status?.financialImport ? "Continue giving import" : "Import giving records"}</button></div></div>}
    {status?.configured && status.financialEnabled && status.financialImport && <button className="button button-secondary" type="button" onClick={() => void loadFinancialTransactions()} disabled={busy}>Browse imported giving records</button>}
    {status?.configured && status.financialEnabled && financialTransactions.length > 0 && <div className="sync-connection-form"><strong>Imported giving records ({financialTransactions.length} of {financialTotal})</strong>{financialTransactions.map((item) => <div className="sync-feedback" key={item.sourceId}><strong>{item.date}</strong><span>{String(item.total)} <button className="button button-secondary" type="button" onClick={() => void viewFinancialTransaction(item.sourceId)} disabled={busy}>View</button></span></div>)}{financialTransactions.length < financialTotal && <button className="button button-secondary" type="button" onClick={() => void loadFinancialTransactions(financialTransactions.length, true)} disabled={busy}>Load more giving records</button>}</div>}
    {financialDetail && <div className="sync-connection-form" aria-live="polite"><h3>Giving record · {financialDetail.date}</h3><small className="sync-help">Imported {new Date(financialDetail.importedAt).toLocaleString()}</small><pre className="sync-song-json">{JSON.stringify(financialDetail.transaction, null, 2)}</pre></div>}
    {status?.configured && directions.songs !== "off" && directions.songs !== "smart_church_to_elvanto" && <div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => void previewSongs()} disabled={busy}><RefreshCw size={15} />{busy ? "Loading preview…" : "Preview Songs import"}</button><span className="sync-help">Reads songs, arrangements, keys, lyrics, and chord charts. No records are written.</span></div>}
    {status?.configured && status.songsImport && <div className="sync-feedback" aria-live="polite"><strong>Songs import progress</strong><span>{status.songsImport.complete ? "Complete" : <>Next song: {status.songsImport.page}</>}{status.songsImport.total !== null && <> · {status.songsImport.total} songs</>} · {status.songsImport.created} created · {status.songsImport.updated} refreshed</span></div>}
    {status?.configured && status.songs?.length > 0 && <div className="sync-connection-form"><strong>Imported Songs</strong>{status.songs.map((song) => <div className="sync-feedback" key={song.sourceId}><strong>{song.title}</strong><span>{song.arrangements} arrangements <button className="button button-secondary" type="button" onClick={() => void viewSong(song.sourceId)} disabled={busy}>View</button></span></div>)}{status.songs.length < status.songsTotal && <button className="button button-secondary" type="button" onClick={() => void loadMoreSongs()} disabled={busy}>Load more songs ({status.songs.length} of {status.songsTotal})</button>}</div>}
    {songDetail && <div className="sync-connection-form" aria-live="polite"><h3>{songDetail.title}</h3><small className="sync-help">Imported {new Date(songDetail.importedAt).toLocaleString()}</small><strong>Song details</strong><pre className="sync-song-json">{JSON.stringify(songDetail.song, null, 2)}</pre><strong>Arrangements, keys, lyrics, and charts</strong>{songDetail.arrangements.map((arrangement, index) => <div className="sync-feedback" key={String(arrangement.id ?? index)}><strong>{String(arrangement.name ?? arrangement.title ?? `Arrangement ${index + 1}`)}</strong><pre className="sync-song-json">{JSON.stringify(arrangement, null, 2)}</pre></div>)}</div>}
    {songsPreview && <div className="sync-connection-form" aria-live="polite"><div className="sync-feedback"><strong>Songs import preview</strong><span>{songsPreview.songCount} songs scanned of {songsPreview.reportedSongCount} reported by Elvanto{!songsPreview.complete && <em> — preview is incomplete</em>}</span></div><div className="sync-feedback"><span>{songsPreview.createCount} new songs</span> · <span>{songsPreview.updateCount} songs will refresh</span></div>{songsPreview.sample.map((song) => <div className="sync-feedback" key={song.title}><strong>{song.title}</strong><span>{song.action === "update" ? "Refresh" : "New"}</span></div>)}<small className="sync-help">Imports five songs at a time, including all arrangements and keys. Imported snapshots are read-only and are not deleted when absent from Elvanto.</small><div className="community-inline-actions"><button className="button button-primary" type="button" onClick={() => void importSongs()} disabled={busy || !songsPreview.complete || songsPreview.songCount === 0}><Check size={15} />{busy ? "Importing…" : status?.songsImport?.complete ? "Refresh Songs from Elvanto" : status?.songsImport ? "Continue Songs import" : "Import Songs"}</button></div></div>}
    {status?.configured && status.peopleImport && <div className="sync-feedback" aria-live="polite"><strong>People import progress</strong><span>{status.peopleImport.complete ? "Complete" : <>Next Elvanto page: {status.peopleImport.page}</>}{status.peopleImport.total !== null && <> · {status.peopleImport.total} records</>} · {status.peopleImport.created} created · {status.peopleImport.updated} updated · {status.peopleImport.skipped} skipped</span></div>}
    {status?.configured && status.peopleFlowsImport && <div className="sync-feedback" aria-live="polite"><strong>People Flows import progress</strong><span>{status.peopleFlowsImport.complete ? "Complete" : <>Next batch: {status.peopleFlowsImport.page}</>}{status.peopleFlowsImport.total !== null && <> · {status.peopleFlowsImport.total} flows</>} · {status.peopleFlowsImport.created} created · {status.peopleFlowsImport.updated} updated · {status.peopleFlowsImport.skipped} skipped</span></div>}
    {status?.configured && status.peopleFlows?.length > 0 && <div className="sync-connection-form"><strong>Imported People Flows</strong>{status.peopleFlows.map((flow) => <div className="sync-feedback" key={flow.sourceId}><strong>{flow.name}</strong><span>{flow.steps} steps · {flow.members} assignments <button className="button button-secondary" type="button" onClick={() => void viewPeopleFlow(flow.sourceId)} disabled={busy}>View</button></span></div>)}</div>}
    {peopleFlowDetail && <div className="sync-connection-form" aria-live="polite"><h3>{peopleFlowDetail.name}</h3><small className="sync-help">Imported {new Date(peopleFlowDetail.importedAt).toLocaleString()}</small><strong>Steps and instructions</strong>{peopleFlowDetail.definition.steps.map((step) => <div className="sync-feedback" key={step.id}><strong>{step.name}</strong>{step.description && <span>{step.description}</span>}{step.instructions && <small>{step.instructions}</small>}{typeof step.due.days === "number" || typeof step.due.days === "string" ? <small className="sync-help">Due after {String(step.due.days)} {String(step.due.type ?? "days")}</small> : null}</div>)}<strong>Assignments ({peopleFlowDetail.members.length} of {peopleFlowDetail.memberTotal})</strong>{peopleFlowDetail.members.map((member, index) => <div className="sync-feedback" key={`${member.stepId}-${member.personId}-${index}`}><strong>{member.contactName || `Elvanto person ${member.personId}`}</strong><span>{member.stepName} · {member.status || "Not started"}{member.dueDate ? ` · due ${member.dueDate}` : ""}{member.assignedAdminId ? ` · assigned to ${member.assignedAdminId}` : ""}{member.completedDate ? ` · completed ${member.completedDate}` : ""}{member.completedBy ? ` · completed by ${member.completedBy}` : ""}</span></div>)}{peopleFlowDetail.members.length < peopleFlowDetail.memberTotal && <button className="button button-secondary" type="button" onClick={() => void loadMorePeopleFlowAssignments()} disabled={busy}>Load more assignments</button>}</div>}
    {status?.configured && status.groupsImport && <div className="sync-feedback" aria-live="polite"><strong>Groups import progress</strong><span>{status.groupsImport.complete ? "Complete" : <>Next Elvanto page: {status.groupsImport.page}</>}{status.groupsImport.total !== null && <> · {status.groupsImport.total} groups</>} · {status.groupsImport.created} created · {status.groupsImport.updated} updated · {status.groupsImport.skipped} skipped</span></div>}
    {status?.configured && status.servicesImport && <div className="sync-feedback" aria-live="polite"><strong>Services import progress</strong><span>{status.servicesImport.complete ? "Complete" : <>Next Elvanto page: {status.servicesImport.page}</>}{status.servicesImport.total !== null && <> · {status.servicesImport.total} Elvanto services</>} · {status.servicesImport.created} events created · {status.servicesImport.updated} updated · {status.servicesImport.skipped} skipped</span></div>}
    {status?.configured && status.calendarImport && <div className="sync-feedback" aria-live="polite"><strong>Calendar import progress</strong><span>{status.calendarImport.startDate && status.calendarImport.endDate ? `${status.calendarImport.startDate} – ${status.calendarImport.endDate} · ` : ""}{status.calendarImport.complete ? "Complete" : <>Next Elvanto page: {status.calendarImport.page}</>}{status.calendarImport.total !== null && <> · {status.calendarImport.total} events</>} · {status.calendarImport.created} created · {status.calendarImport.updated} updated · {status.calendarImport.skipped} skipped</span></div>}
    {permissionChecks && <div className="sync-connection-form" aria-live="polite">{permissionChecks.map((check) => <div className="sync-feedback" key={check.area}><span className={check.accessible ? "event-kind event-kind-service" : "event-kind event-kind-other"}>{check.accessible ? "Read access confirmed" : "Read access failed"}</span><strong>{areas.find(({ id }) => id === check.area)?.label}</strong>{typeof check.recordCount === "number" && <span>{check.recordCount} records</span>}{check.detail && <small>{check.detail}</small>}</div>)}</div>}
    {peoplePreview && <div className="sync-connection-form" aria-live="polite">
      <div className="sync-feedback"><strong>People import preview</strong><span>{peoplePreview.scannedCount} scanned{peoplePreview.reportedTotal !== null && <> of {peoplePreview.reportedTotal} reported by Elvanto</>} · {peoplePreview.customFieldCount} custom fields included{!peoplePreview.complete && <em> — preview is incomplete</em>}</span></div>
      <div className="sync-feedback"><span>{peoplePreview.createCount} new</span> · <span>{peoplePreview.alreadyLinkedCount} already linked</span> · <span>{peoplePreview.emailMatchCount} email matches needing review</span> · <span>{peoplePreview.ambiguousEmailCount} ambiguous email matches</span> · <span>{peoplePreview.invalidCount} records needing review</span></div>
      {peoplePreview.sample.map((person, index) => <div className="sync-feedback" key={`${person.email ?? person.firstName}-${index}`}><strong>{person.firstName} {person.lastName}</strong><span>{person.email || "No email"} · {person.action === "already_linked" ? "Already linked" : person.action === "review_email_match" ? "Review email match" : person.action === "review_ambiguous_email" ? "Review ambiguous email match" : person.action === "needs_review" ? "Needs review" : person.action === "duplicate_source_id" ? "Duplicate Elvanto ID" : "New contact"}</span></div>)}
      <small className="sync-help">Email matches are shown for review only. They will not be merged automatically.</small>
      <div className="community-inline-actions"><button className="button button-primary" type="button" onClick={() => void importPeople()} disabled={busy || !peoplePreview.complete || (peoplePreview.createCount + peoplePreview.alreadyLinkedCount === 0)}><Check size={15} />{busy ? "Importing…" : status?.peopleImport?.complete ? "Refresh People from Elvanto" : status?.peopleImport ? "Continue People import" : "Import eligible contacts"}</button><span className="sync-help">Requires a complete preview. Work advances five Elvanto pages per batch; email matches are skipped for manual resolution.</span></div>
    </div>}
    {status?.configured && status.peopleExport && <div className="sync-feedback" aria-live="polite"><strong>People export progress</strong><span>{status.peopleExport.complete ? "Complete" : <>Next contact: {status.peopleExport.page + 1}</>} of {status.peopleExport.total} · {status.peopleExport.created} created · {status.peopleExport.updated} updated · {status.peopleExport.skipped} needing review</span></div>}
    {peopleExportPreview && <div className="sync-connection-form" aria-live="polite"><div className="sync-feedback"><strong>People export preview</strong><span>{peopleExportPreview.total} local contacts · {peopleExportPreview.create} new · {peopleExportPreview.update} updates · {peopleExportPreview.review} needing review</span></div>{peopleExportPreview.sample.map((person, index) => <div className="sync-feedback" key={`${person.email ?? person.firstName}-${index}`}><strong>{person.firstName} {person.lastName}</strong><span>{person.email || "No email"} · {person.action.replaceAll("_", " ")}</span></div>)}<small className="sync-help">Only local contacts are sent. Elvanto email matches and contacts missing upstream are not created or changed automatically. Each batch writes at most five records.</small><div className="community-inline-actions"><button className="button button-primary" type="button" onClick={() => void exportPeople()} disabled={busy || !peopleExportPreview.complete || peopleExportPreview.create + peopleExportPreview.update === 0}><Check size={15} />{busy ? "Exporting…" : status?.peopleExport && !status.peopleExport.complete ? "Continue People export" : "Export People to Elvanto"}</button></div></div>}
    {peopleFlowsPreview && <div className="sync-connection-form" aria-live="polite">
      <div className="sync-feedback"><strong>People Flows import preview</strong><span>{peopleFlowsPreview.flowCount} flows scanned of {peopleFlowsPreview.reportedFlowCount} reported by Elvanto · {peopleFlowsPreview.stepCount} steps · {peopleFlowsPreview.assignmentCount} assignments{!peopleFlowsPreview.complete && <em> — preview is incomplete</em>}</span></div>
      <div className="sync-feedback"><span>{peopleFlowsPreview.createCount} new flows</span> · <span>{peopleFlowsPreview.updateCount} already imported and will refresh</span></div>
      {peopleFlowsPreview.sample.map((flow) => <div className="sync-feedback" key={flow.name}><strong>{flow.name}</strong><span>{flow.steps} steps · {flow.assignments} assignments · {flow.action === "update" ? "Refresh" : "New"}</span></div>)}
      <small className="sync-help">Assignments link to stable Elvanto person IDs. Imported flow definitions and assignments are read-only; records absent from Elvanto are not deleted. Continue in batches of five flows.</small>
      <div className="community-inline-actions"><button className="button button-primary" type="button" onClick={() => void importPeopleFlows()} disabled={busy || !peopleFlowsPreview.complete || peopleFlowsPreview.flowCount === 0}><Check size={15} />{busy ? "Importing…" : status?.peopleFlowsImport?.complete ? "Refresh People Flows from Elvanto" : status?.peopleFlowsImport ? "Continue People Flows import" : "Import People Flows"}</button></div>
    </div>}
    {groupsPreview && <div className="sync-connection-form" aria-live="polite">
      <div className="sync-feedback"><strong>Groups import preview</strong><span>{groupsPreview.scannedCount} scanned{groupsPreview.reportedTotal !== null && <> of {groupsPreview.reportedTotal} reported by Elvanto</>}{!groupsPreview.complete && <em> — preview is incomplete</em>}</span></div>
      <div className="sync-feedback"><span>{groupsPreview.createCount} new groups</span> · <span>{groupsPreview.alreadyLinkedCount} already linked</span> · <span>{groupsPreview.nameConflictCount} name conflicts to review</span> · <span>{groupsPreview.invalidCount} invalid groups</span></div>
      <div className="sync-feedback"><span>{groupsPreview.memberCount} member assignments found</span> · <span>{groupsPreview.linkedMemberCount} members linked to imported Elvanto people</span> · <span>{groupsPreview.unmatchedMemberCount} members need the People import first</span></div>
      {groupsPreview.sample.map((group, index) => <div className="sync-feedback" key={`${group.name}-${index}`}><strong>{group.name}</strong><span>{group.members} members · {group.linkedMembers} linked · {group.action === "already_linked" ? "Already linked" : group.action === "review_name_conflict" ? "Review name conflict" : group.action === "needs_review" ? "Needs review" : group.action === "duplicate_source_id" ? "Duplicate Elvanto ID" : "New group"}</span></div>)}
      <small className="sync-help">Requires a complete preview. Work advances five Elvanto pages per batch. Same-name groups are skipped for manual resolution.</small>
      <div className="community-inline-actions"><button className="button button-primary" type="button" onClick={() => void importGroups()} disabled={busy || !groupsPreview.complete || groupsPreview.createCount + groupsPreview.alreadyLinkedCount === 0}><Check size={15} />{busy ? "Importing…" : status?.groupsImport?.complete ? "Refresh Groups from Elvanto" : status?.groupsImport ? "Continue Groups import" : "Import eligible groups"}</button></div>
    </div>}
    {servicesPreview && <div className="sync-connection-form" aria-live="polite">
      <div className="sync-feedback"><strong>Services import preview</strong><span>{servicesPreview.scannedCount} service times scanned{servicesPreview.reportedTotal !== null && <> across {servicesPreview.reportedTotal} Elvanto services</>}{!servicesPreview.complete && <em> — preview is incomplete</em>}</span></div>
      <div className="sync-feedback"><span>{servicesPreview.createCount} new</span> · <span>{servicesPreview.alreadyLinkedCount} already linked</span> · <span>{servicesPreview.conflictCount} same-title/date conflicts</span> · <span>{servicesPreview.invalidCount} invalid or duplicate rows</span></div>
      {servicesPreview.sample.map((service, index) => <div className="sync-feedback" key={`${service.date}-${service.title}-${index}`}><strong>{service.title}</strong><span>{service.date} · {service.action === "already_linked" ? "Already linked" : service.action === "review_event_conflict" ? "Review event conflict" : service.action === "needs_review" ? "Needs review" : service.action === "duplicate_source_id" ? "Duplicate Elvanto ID" : "New service"}</span></div>)}
      <small className="sync-help">Only complete previews can be imported. Each batch advances up to five Elvanto pages. Imported events are read-only and are not deleted when absent from Elvanto.</small>
      <div className="community-inline-actions"><button className="button button-primary" type="button" onClick={() => void importServices()} disabled={busy || !servicesPreview.complete || servicesPreview.createCount + servicesPreview.alreadyLinkedCount === 0}><Check size={15} />{busy ? "Importing…" : status?.servicesImport?.complete ? "Refresh Services from Elvanto" : status?.servicesImport ? "Continue Services import" : "Import eligible services"}</button></div>
    </div>}
    {calendarPreview && <div className="sync-connection-form" aria-live="polite">
      <div className="sync-feedback"><strong>Calendar import preview</strong><span>{calendarPreview.scannedCount} events scanned, {calendarPreview.startDate} – {calendarPreview.endDate}{!calendarPreview.complete && <em> — preview is incomplete</em>}</span></div>
      <div className="sync-feedback"><span>{calendarPreview.createCount} new</span> · <span>{calendarPreview.alreadyLinkedCount} already linked</span> · <span>{calendarPreview.conflictCount} same-title/date conflicts</span> · <span>{calendarPreview.invalidCount} invalid or duplicate rows</span></div>
      {calendarPreview.sample.map((event, index) => <div className="sync-feedback" key={`${event.date}-${event.title}-${index}`}><strong>{event.title}</strong><span>{event.date} · {event.action === "already_linked" ? "Already linked" : event.action === "review_event_conflict" ? "Review event conflict" : event.action === "needs_review" ? "Needs review" : event.action === "duplicate_source_id" ? "Duplicate Elvanto ID" : "New event"}</span></div>)}
      <small className="sync-help">Only the selected date range is imported. All-day items appear at midnight; the event schedule does not support multi-day calendar records.</small>
      <div className="community-inline-actions"><button className="button button-primary" type="button" onClick={() => void importCalendar()} disabled={busy || !calendarPreview.complete || calendarPreview.createCount + calendarPreview.alreadyLinkedCount === 0}><Check size={15} />{busy ? "Importing…" : status?.calendarImport?.complete ? "Refresh Calendar from Elvanto" : status?.calendarImport ? "Continue Calendar import" : "Import eligible calendar events"}</button></div>
    </div>}
    {feedback && <p className="sync-feedback" role="status"><Link2 size={15} />{feedback}</p>}
    {error && <p className="sync-feedback sync-feedback-error" role="alert"><CircleAlert size={15} />{error}</p>}
  </section>;
}
