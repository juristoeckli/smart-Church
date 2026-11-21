import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, ContactRound, Download, Link2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import type { ChurchGroup, Contact, GroupLifecycleStatus } from "@smart-church/contracts";
import { formatUserDate } from "./date-format";
import { getActiveLanguage, translate } from "./i18n";
import { translateModuleMessage } from "./modules/translations";

type GroupMeeting = { id: string; date: string; title: string; attendeeCount: number; presentCount: number };
type AttendanceEntry = { contactId: string; firstName: string; lastName: string; status: "present" | "absent" | "excused" };
type GroupJoinRequest = { id: string; groupId: string; firstName: string; lastName: string; email: string; status: "pending"; createdAt: string };
type GroupStatusFilter = "all" | GroupLifecycleStatus;
type GroupSortOrder = "name_asc" | "name_desc" | "members_desc" | "start_desc";
const groupColumns = [
  { key: "type", label: "Type", value: (group: ChurchGroup) => group.groupType },
  { key: "status", label: "Status", value: (group: ChurchGroup) => group.status },
  { key: "members", label: "Members", value: (group: ChurchGroup) => group.memberCount },
  { key: "start", label: "Start date", value: (group: ChurchGroup) => group.startsOn && formatUserDate(group.startsOn) },
  { key: "end", label: "End date", value: (group: ChurchGroup) => group.endsOn && formatUserDate(group.endsOn) },
] as const;
type GroupColumn = (typeof groupColumns)[number]["key"];
const defaultGroupColumns: GroupColumn[] = groupColumns.map(({ key }) => key);

type SavedGroupView = { id: string; name: string; searchText: string; statusFilter: GroupStatusFilter; groupTypeFilter?: string; sortOrder?: GroupSortOrder; displayMode?: "list" | "table"; visibleColumns?: GroupColumn[]; createdAt: string; updatedAt: string };

function csvCell(value: string | number) {
  const text = String(value);
  const safeText = typeof value === "string" && (/^\s*[=+\-@＝＋－＠]/u.test(text) || /^[\t\r\n]/.test(text)) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

function downloadCsv(rows: (string | number)[][], fileName: string) {
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

type GroupTypeChange = {
  id: string;
  previousType: string | null;
  newType: string;
  createdAt: string;
  actorName: string | null;
};

function GroupTypeHistory({ departmentId, groupId, groupType }: { departmentId: string; groupId: string; groupType?: string }) {
  const [open, setOpen] = useState(false);
  const [changes, setChanges] = useState<GroupTypeChange[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setChanges(null);
    setFailed(false);
    void (async () => {
      try {
        const response = await fetch(`/api/groups/${groupId}/type-history`, {
          headers: { "x-department-id": departmentId },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Could not load group type history.");
        const entries: GroupTypeChange[] = await response.json();
        if (!controller.signal.aborted) setChanges(entries);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [departmentId, groupId, groupType, open]);

  return <details onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Bulk type change history</summary>
    {failed ? <p role="alert">Could not load group type history.</p>
      : changes === null ? <p role="status">Loading type changes…</p>
      : changes.length === 0 ? <p>No bulk type changes recorded.</p>
      : <ul>{changes.map((change) => <li key={change.id}>
        <time dateTime={change.createdAt}>{formatUserDate(change.createdAt, true)}</time>
        {" · "}{change.actorName || "Unknown actor"}{" · "}
        {change.previousType || "Not set"}{" → "}{change.newType || "Not set"}
      </li>)}</ul>}
  </details>;
}

export function Groups({ departmentId, contacts, canManage, csrfToken, navigationTarget, createRequestId = 0, onNavigationHandled }: { departmentId: string; contacts: Contact[]; canManage: boolean; csrfToken: string; navigationTarget?: { id: string; requestId: number } | null; createRequestId?: number; onNavigationHandled?: (requestId: number) => void }) {
  const [groups, setGroups] = useState<ChurchGroup[]>([]);
  const [loadedDepartmentId, setLoadedDepartmentId] = useState("");
  const [directorySearch, setDirectorySearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<GroupStatusFilter>("all");
  const [groupTypeFilter, setGroupTypeFilter] = useState("");
  const [sortOrder, setSortOrder] = useState<GroupSortOrder>("name_asc");
  const [displayMode, setDisplayMode] = useState<"list" | "table">("list");
  const [visibleColumns, setVisibleColumns] = useState<GroupColumn[]>(defaultGroupColumns);
  const displayedColumns = groupColumns.filter(({ key }) => visibleColumns.includes(key));
  const [savedViews, setSavedViews] = useState<SavedGroupView[]>([]);
  const [selectedSavedViewId, setSelectedSavedViewId] = useState("");
  const [savedViewName, setSavedViewName] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [detailsGroup, setDetailsGroup] = useState<ChurchGroup | null>(null);
  const [memberDraft, setMemberDraft] = useState<string[]>([]);
  const [memberDetailsDraft, setMemberDetailsDraft] = useState<Record<string, { role: string; status: "active" | "paused" | "waitlist"; joinedOn?: string }>>({});
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [groupType, setGroupType] = useState("");
  const [groupStatus, setGroupStatus] = useState<GroupLifecycleStatus>("active");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [meetings, setMeetings] = useState<GroupMeeting[]>([]);
  const [meetingDate, setMeetingDate] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10));
  const [meetingTitle, setMeetingTitle] = useState("");
  const [activeMeetingId, setActiveMeetingId] = useState("");
  const [attendance, setAttendance] = useState<AttendanceEntry[]>([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceSaving, setAttendanceSaving] = useState(false);
  const [joinRequests, setJoinRequests] = useState<GroupJoinRequest[]>([]);
  const [requestContactIds, setRequestContactIds] = useState<Record<string, string>>({});
  const [signupSaving, setSignupSaving] = useState(false);
  const visibleGroups = useMemo(() => {
    const normalized = directorySearch.trim().toLocaleLowerCase();
    return groups.filter((group) => {
      return (statusFilter === "all" || group.status === statusFilter) && (!groupTypeFilter || group.groupType === groupTypeFilter) && (!normalized || `${group.name} ${group.groupType ?? ""}`.toLocaleLowerCase().includes(normalized));
    }).sort((left, right) => {
      const compareName = left.name.localeCompare(right.name);
      if (sortOrder === "name_desc") return -compareName;
      if (sortOrder === "members_desc") return right.memberCount - left.memberCount || compareName;
      if (sortOrder === "start_desc") return (right.startsOn ?? "").localeCompare(left.startsOn ?? "") || compareName;
      return compareName;
    });
  }, [directorySearch, groupTypeFilter, groups, sortOrder, statusFilter]);
  const availableGroupTypes = useMemo(() => [...new Set([
    ...groups.map((group) => group.groupType?.trim()).filter((type): type is string => Boolean(type)),
    ...savedViews.map((view) => view.groupTypeFilter?.trim()).filter((type): type is string => Boolean(type)),
    ...(groupTypeFilter ? [groupTypeFilter] : []),
  ])].sort((a, b) => a.localeCompare(b)), [groupTypeFilter, groups, savedViews]);
  const availableStatuses = useMemo<GroupLifecycleStatus[]>(() => [...new Set<GroupLifecycleStatus>([
    ...groups.map((group) => group.status),
    ...savedViews.map((view) => view.statusFilter).filter((status): status is GroupLifecycleStatus => status !== "all"),
    ...(statusFilter === "all" ? [] : [statusFilter]),
  ])].sort(), [groups, savedViews, statusFilter]);
  const directoryPageSize = 50;
  const directoryPageCount = Math.max(1, Math.ceil(visibleGroups.length / directoryPageSize));
  const directoryFilterKey = JSON.stringify([departmentId, directorySearch, statusFilter, groupTypeFilter, sortOrder]);
  const [directoryPagination, setDirectoryPagination] = useState({ filterKey: "", page: 1 });
  const directoryPage = directoryPagination.filterKey === directoryFilterKey
    ? Math.min(directoryPagination.page, directoryPageCount)
    : 1;
  const directoryOffset = (directoryPage - 1) * directoryPageSize;
  const pageGroups = visibleGroups.slice(directoryOffset, directoryOffset + directoryPageSize);
  const changeDirectoryPage = (page: number) => setDirectoryPagination({ filterKey: directoryFilterKey, page });

  const selected = visibleGroups.find((group) => group.id === selectedId) ?? null;
  const memberListChanged = Boolean(selected && (
    memberDraft.length !== selected.memberIds.length || memberDraft.some((id) => !selected.memberIds.includes(id)) ||
    memberDraft.some((id) => {
      const draft = memberDetailsDraft[id];
      const saved = selected.memberDetails?.find((item) => item.contactId === id);
      return !draft || !saved || draft.role !== saved.role || draft.status !== saved.status || draft.joinedOn !== saved.joinedOn;
    })
  ));

  const [bulkType, setBulkType] = useState("");
  const [bulkSelection, setBulkSelection] = useState<string[]>([]);
  const [bulkSaving, setBulkSaving] = useState(false);
  const localVisibleGroups = visibleGroups.filter((group) => !group.importedFrom);
  const bulkSelectedIds = localVisibleGroups.filter((group) => bulkSelection.includes(group.id)).map((group) => group.id);

  useEffect(() => {
    setBulkSelection([]);
    setBulkType("");
  }, [departmentId]);

  async function updateSelectedGroupTypes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !bulkSelectedIds.length || bulkSaving) return;
    const type = bulkType.trim();
    if (!window.confirm(type ? `Set the group type to "${type}" for ${bulkSelectedIds.length} groups?` : `Clear the group type for ${bulkSelectedIds.length} groups?`)) return;
    setError("");
    setBulkSaving(true);
    try {
      const response = await fetch("/api/groups/bulk-type", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify({ groupIds: bulkSelectedIds, groupType: type }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not update group types.");
      setBulkSelection([]);
      setDetailsGroup(null);
      await loadGroups();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update group types.");
    } finally {
      setBulkSaving(false);
    }
  }

  async function loadGroups(signal?: AbortSignal) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/groups", { headers: { "x-department-id": departmentId }, signal });
      const result = await response.json() as ChurchGroup[] | { error?: string };
      if (!response.ok || !Array.isArray(result)) throw new Error(!Array.isArray(result) ? result.error ?? "Could not load groups." : "Could not load groups.");
      if (signal?.aborted) return;
      setGroups(result);
      setLoadedDepartmentId(departmentId);
      setSelectedId((current) => result.some((group) => group.id === current) ? current : result[0]?.id ?? "");
    } catch (reason) { if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "Could not load groups."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadGroups(controller.signal);
    setDirectorySearch(""); setStatusFilter("all"); setGroupTypeFilter(""); setSortOrder("name_asc"); setDisplayMode("list"); setVisibleColumns(defaultGroupColumns); setSavedViews([]); setSelectedSavedViewId(""); setSavedViewName("");
    void fetch("/api/groups/views", { headers: { "x-department-id": departmentId }, signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as SavedGroupView[] | { error?: string };
        if (!response.ok || !Array.isArray(result)) throw new Error(!Array.isArray(result) ? result.error ?? "Could not load saved group views." : "Could not load saved group views.");
        setSavedViews(result);
      }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load saved group views."); });
    return () => controller.abort();
  }, [departmentId]);

  useEffect(() => {
    if (selectedId && !visibleGroups.some((group) => group.id === selectedId)) setSelectedId(visibleGroups[0]?.id ?? "");
  }, [selectedId, visibleGroups]);

  useEffect(() => {
    if (!navigationTarget || loading) return;
    const group = groups.find((item) => item.id === navigationTarget.id);
    if (group) {
      setDirectorySearch("");
      setStatusFilter("all");
      setSelectedId(group.id);
      setDetailsGroup(group);
    }
    onNavigationHandled?.(navigationTarget.requestId);
  }, [navigationTarget, groups, loading, onNavigationHandled]);

  useEffect(() => {
    if (!createRequestId || !canManage) return;
    setSelectedId(""); setDetailsGroup(null); setName(""); setDescription(""); setGroupType(""); setGroupStatus("active"); setStartsOn(""); setEndsOn(""); setEditing(false);
  }, [createRequestId, canManage]);

  async function saveDirectoryView(action: "save" | "update" | "rename" = "save") {
    if (!savedViewName.trim()) { setError("Enter a name for this saved view."); return; }
    setSaving(true); setError(""); setFeedback("");
    try {
      const url = action === "save" ? "/api/groups/views" : "/api/groups/views/" + encodeURIComponent(selectedSavedViewId);
      const name = savedViewName.trim();
      const body = action === "rename" ? { name } : { name, searchText: directorySearch, statusFilter, groupTypeFilter, sortOrder, displayMode, visibleColumns };
      const response = await fetch(url, { method: action === "save" ? "POST" : "PATCH", headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken }, body: JSON.stringify(body) });
      const result = await response.json() as SavedGroupView | { error?: string };
      if (!response.ok || !("id" in result)) throw new Error("error" in result ? result.error ?? "Could not save this view." : "Could not save this view.");
      setSavedViews((current) => [...current.filter((view) => view.id !== result.id), result].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedSavedViewId(result.id); setSavedViewName(result.name); setFeedback(action === "rename" ? "Group view renamed." : "Group view saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save this view."); }
    finally { setSaving(false); }
  }

  async function deleteSavedView() {
    const view = savedViews.find((item) => item.id === selectedSavedViewId);
    if (!view) return;
    setSaving(true); setError(""); setFeedback("");
    try {
      const response = await fetch(`/api/groups/views/${view.id}`, { method: "DELETE", headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken } });
      const result = await response.json() as { deleted?: boolean; error?: string };
      if (!response.ok || !result.deleted) throw new Error(result.error ?? "Could not delete this view.");
      setSavedViews((current) => current.filter((item) => item.id !== view.id)); setSelectedSavedViewId(""); setSavedViewName(""); setFeedback("Group view deleted.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete this view."); }
    finally { setSaving(false); }
  }

  function applySavedView(id: string) {
    const view = savedViews.find((item) => item.id === id);
    setSelectedSavedViewId(id); setSavedViewName(view?.name ?? ""); setDirectorySearch(view?.searchText ?? ""); setStatusFilter(view?.statusFilter ?? "all"); setGroupTypeFilter(view?.groupTypeFilter ?? ""); setSortOrder(view?.sortOrder ?? "name_asc");
    setDisplayMode(view?.displayMode ?? "list");
    setVisibleColumns(view?.visibleColumns ?? defaultGroupColumns);
  }

  useEffect(() => {
    if (!selected) { setName(""); setDescription(""); setGroupType(""); setGroupStatus("active"); setStartsOn(""); setEndsOn(""); setMemberDraft([]); setEditing(false); return; }
    setName(selected.name);
    setDescription(selected.description);
    setGroupType(selected.groupType ?? "");
    setGroupStatus(selected.status);
    setStartsOn(selected.startsOn ?? "");
    setEndsOn(selected.endsOn ?? "");
    setMemberDraft(selected.memberIds);
    setMemberDetailsDraft(Object.fromEntries((selected.memberDetails ?? []).map((member) => [member.contactId, { role: member.role, status: member.status, joinedOn: member.joinedOn }])));
    setEditing(false);
  }, [selectedId, selected?.name, selected?.description, selected?.groupType, selected?.status, selected?.startsOn, selected?.endsOn, selected?.memberIds.join(",")]);

  useEffect(() => {
    setMeetings([]);
    setActiveMeetingId("");
    setAttendance([]);
    if (!selected || selected.importedFrom) return;
    const controller = new AbortController();
    void fetch(`/api/groups/${selected.id}/meetings`, { headers: { "x-department-id": departmentId }, signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as GroupMeeting[] | { error?: string };
        if (!response.ok || !Array.isArray(result)) throw new Error(!Array.isArray(result) ? result.error ?? "Could not load meetings." : "Could not load meetings.");
        setMeetings(result);
      }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load meetings."); });
    return () => controller.abort();
  }, [departmentId, selectedId, selected?.importedFrom]);

  useEffect(() => {
    setJoinRequests([]);
    setRequestContactIds({});
    if (!selected || !canManage || selected.importedFrom) return;
    const controller = new AbortController();
    void fetch(`/api/groups/${selected.id}/join-requests`, { headers: { "x-department-id": departmentId }, signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as GroupJoinRequest[] | { error?: string };
        if (!response.ok || !Array.isArray(result)) throw new Error(!Array.isArray(result) ? result.error ?? "Could not load join requests." : "Could not load join requests.");
        setJoinRequests(result);
        setRequestContactIds(Object.fromEntries(result.flatMap((request) => {
          const matches = contacts.filter((person) => person.email?.trim().toLocaleLowerCase() === request.email.toLocaleLowerCase());
          return matches.length === 1 ? [[request.id, matches[0].id]] : [];
        })));
      }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load join requests."); });
    return () => controller.abort();
  }, [canManage, contacts, departmentId, selectedId, selected?.importedFrom]);

  useEffect(() => {
    if (!activeMeetingId) { setAttendance([]); return; }
    const controller = new AbortController();
    setAttendanceLoading(true);
    void fetch(`/api/group-meetings/${activeMeetingId}/attendance`, { headers: { "x-department-id": departmentId }, signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as AttendanceEntry[] | { error?: string };
        if (!response.ok || !Array.isArray(result)) throw new Error(!Array.isArray(result) ? result.error ?? "Could not load attendance." : "Could not load attendance.");
        setAttendance(result);
      }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load attendance."); })
      .finally(() => { if (!controller.signal.aborted) setAttendanceLoading(false); });
    return () => controller.abort();
  }, [activeMeetingId, departmentId]);

  const visibleContacts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return contacts.filter((contact) => !normalized || `${contact.firstName} ${contact.lastName}`.toLocaleLowerCase().includes(normalized));
  }, [contacts, query]);

  async function saveGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(editing && selected ? `/api/groups/${selected.id}` : "/api/groups", {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json", "x-department-id": departmentId },
      body: JSON.stringify({ name, description, groupType: groupType.trim(), status: groupStatus, startsOn: startsOn || null, endsOn: endsOn || null }),
      });
      const result = await response.json() as ChurchGroup | { error?: string };
      if (!response.ok || !("id" in result)) throw new Error("error" in result ? result.error ?? "Could not save the group." : "Could not save the group.");
      if (editing) setGroups((current) => current.map((group) => group.id === result.id ? result : group));
      else { setGroups((current) => [...current, result].sort((a, b) => a.name.localeCompare(b.name))); setSelectedId(result.id); }
      setEditing(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the group."); }
    finally { setSaving(false); }
  }

  async function setPublicSignupEnabled(enabled: boolean) {
    if (!selected) return;
    setSignupSaving(true); setError("");
    try {
      const response = await fetch(`/api/groups/${selected.id}/public-signup`, { method: "PUT", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify({ enabled }) });
      const result = await response.json() as { enabled?: boolean; token?: string; error?: string };
      if (!response.ok || result.enabled === undefined) throw new Error(result.error ?? "Could not update group sign-up settings.");
      setGroups((current) => current.map((group) => group.id === selected.id ? { ...group, publicSignupEnabled: result.enabled, publicSignupToken: result.token } : group));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update group sign-up settings."); }
    finally { setSignupSaving(false); }
  }

  async function reviewJoinRequest(joinRequest: GroupJoinRequest, decision: "approved" | "declined") {
    if (!selected) return;
    const matches = contacts.filter((person) => person.email?.trim().toLocaleLowerCase() === joinRequest.email.toLocaleLowerCase());
    const contactId = requestContactIds[joinRequest.id] || (matches.length === 1 ? matches[0].id : undefined);
    if (decision === "approved" && matches.length > 1 && !contactId) { setError("Choose which existing person matches this request."); return; }
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/groups/${selected.id}/join-requests/${joinRequest.id}`, {
        method: "PUT", headers: { "content-type": "application/json", "x-department-id": departmentId },
        body: JSON.stringify({ decision, ...(decision === "approved" && contactId ? { contactId } : {}) }),
      });
      const result = await response.json() as { status?: string; error?: string };
      if (!response.ok || result.status !== decision) throw new Error(result.error ?? "Could not update the join request.");
      setJoinRequests((current) => current.filter((item) => item.id !== joinRequest.id));
      if (decision === "approved") {
        await loadGroups();
        setFeedback(translate("groups.approvedFeedback"));
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update the join request."); }
    finally { setSaving(false); }
  }

  async function copyGroupSignupLink(group: ChurchGroup) {
    if (!group.publicSignupToken) return;
    try { await navigator.clipboard.writeText(`${window.location.origin}/join-group/${group.publicSignupToken}`); setFeedback(translate("groups.linkCopied")); }
    catch { setError("Could not copy the sign-up link."); }
  }

  async function saveMembers() {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      const members = memberDraft.map((contactId) => ({ contactId, role: memberDetailsDraft[contactId]?.role.trim() || "Member", status: memberDetailsDraft[contactId]?.status ?? "active", ...(memberDetailsDraft[contactId]?.joinedOn ? { joinedOn: memberDetailsDraft[contactId].joinedOn } : {}) }));
      const response = await fetch(`/api/groups/${selected.id}/members`, {
        method: "PUT", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify({ members }),
      });
      const result = await response.json() as { memberIds?: string[]; memberDetails?: ChurchGroup["memberDetails"]; error?: string };
      if (!response.ok || !result.memberIds || !result.memberDetails) throw new Error(result.error ?? "Could not save group members.");
      setGroups((current) => current.map((group) => group.id === selected.id ? { ...group, memberIds: result.memberIds!, memberDetails: result.memberDetails, memberCount: result.memberIds!.length } : group));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save group members."); }
    finally { setSaving(false); }
  }

  async function createMeeting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/groups/${selected.id}/meetings`, { method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify({ date: meetingDate, title: meetingTitle.trim() }) });
      const result = await response.json() as GroupMeeting | { error?: string };
      if (!response.ok || !("id" in result)) throw new Error("error" in result ? result.error ?? "Could not create the meeting." : "Could not create the meeting.");
      setActiveMeetingId(result.id);
      setMeetingTitle("");
      const listResponse = await fetch(`/api/groups/${selected.id}/meetings`, { headers: { "x-department-id": departmentId } });
      const list = await listResponse.json() as GroupMeeting[];
      if (listResponse.ok && Array.isArray(list)) setMeetings(list);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create the meeting."); }
    finally { setSaving(false); }
  }

  async function saveAttendance() {
    if (!activeMeetingId) return;
    setAttendanceSaving(true); setError("");
    try {
      const response = await fetch(`/api/group-meetings/${activeMeetingId}/attendance`, { method: "PUT", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify({ attendance: attendance.map(({ contactId, status }) => ({ contactId, status })) }) });
      const result = await response.json() as { saved?: boolean; error?: string };
      if (!response.ok || !result.saved) throw new Error(result.error ?? "Could not save attendance.");
      setMeetings((current) => current.map((meeting) => meeting.id === activeMeetingId ? { ...meeting, presentCount: attendance.filter((entry) => entry.status === "present").length } : meeting));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save attendance."); }
    finally { setAttendanceSaving(false); }
  }

  function downloadGroupAttendance() {
    const meeting = meetings.find((item) => item.id === activeMeetingId);
    if (!selected || !meeting || attendance.length === 0) return;
    const rows = [
      [translate("groups.name"), translate("groups.meeting"), translate("groups.meetingDate"), translate("events.firstName"), translate("events.lastName"), translate("groups.attendance")],
      ...attendance.map((entry) => [selected.name, meeting.title, formatUserDate(meeting.date), entry.firstName, entry.lastName, translate(`groups.${entry.status}` as "groups.present" | "groups.absent" | "groups.excused")]),
    ];
    downloadCsv(rows, `group-attendance-${meeting.date}.csv`);
  }

  function downloadGroupDirectory() {
    if (loading || loadedDepartmentId !== departmentId || visibleGroups.length === 0) return;
    downloadCsv([
      [translate("groups.name"), ...displayedColumns.map(({ label }) => label)],
      ...visibleGroups.map((group) => [group.name, ...displayedColumns.map(({ value }) => value(group) ?? "")]),
    ], "groups-directory.csv");
  }

  async function deleteGroup(group: ChurchGroup) {
    if (!window.confirm(translate("groups.deleteConfirm").replace("{name}", group.name))) return;
    try {
      const response = await fetch(`/api/groups/${group.id}`, { method: "DELETE", headers: { "x-department-id": departmentId } });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not delete the group.");
      setGroups((current) => current.filter((item) => item.id !== group.id));
      if (selectedId === group.id) setSelectedId(groups.find((item) => item.id !== group.id)?.id ?? "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete the group."); }
  }

  return <>
    <div className={`demo-notice ${error ? "demo-notice-error" : ""}`}><span className="demo-dot" />{error ? translateModuleMessage("core-groups", getActiveLanguage(), error) : feedback || translate("groups.notice").replace("{place}", translate(departmentId ? "groups.yourChurch" : "groups.thisSite"))}{error && <button className="event-retry" type="button" onClick={() => void loadGroups()}>{translate("groups.tryAgain")}</button>}</div>
    <section className="page-heading"><div><div className="eyebrow">{translate("groups.eyebrow")}</div><h1>{translate("groups.title")}</h1><p className="page-subtitle">{translate("groups.subtitle")}</p></div>{canManage && <button className="button button-primary" type="button" onClick={() => { setSelectedId(""); setName(""); setDescription(""); setGroupType(""); setGroupStatus("active"); setStartsOn(""); setEndsOn(""); setEditing(false); }}><Plus size={17} />{" "}{translate("groups.new")}</button>}</section>
    <section className="community-groups-layout">
      <section className="directory-card community-group-list"><div className="directory-heading"><div><h2>{translate("groups.listTitle")}</h2><p>{(visibleGroups.length === 1 ? translate("groups.countOne") : translate("groups.count")).replace("{count}", String(visibleGroups.length))}</p></div></div>
        <div className="community-group-directory-tools"><label className="search-field"><Search size={15} /><input type="search" value={directorySearch} onChange={(event) => { setDirectorySearch(event.target.value); }} placeholder="Search groups by name or type" aria-label="Search groups by name or type" /></label><label className="community-group-status-filter">Group status<select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as GroupStatusFilter); }}><option value="all">All statuses</option>{availableStatuses.map((status) => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}</select></label><label className="community-group-status-filter">Group type<select value={groupTypeFilter} onChange={(event) => { setGroupTypeFilter(event.target.value); }}><option value="">All types</option>{availableGroupTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label><label className="community-group-status-filter">Sort groups<select value={sortOrder} onChange={(event) => { setSortOrder(event.target.value as GroupSortOrder); }}><option value="name_asc">Name A–Z</option><option value="name_desc">Name Z–A</option><option value="members_desc">Most members</option><option value="start_desc">Newest start date</option></select></label></div>
        <div className="community-saved-group-views"><select aria-label="Load a saved group view" value={selectedSavedViewId} onChange={(event) => applySavedView(event.target.value)}><option value="">Saved views</option>{savedViews.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</select><input value={savedViewName} maxLength={80} onChange={(event) => setSavedViewName(event.target.value)} placeholder="View name" aria-label="Saved view name" /><button className="button button-secondary" type="button" disabled={saving || !savedViewName.trim()} onClick={() => void saveDirectoryView()}>{saving ? "Saving..." : "Save view"}</button>{selectedSavedViewId && <><button className="button button-secondary" type="button" disabled={saving || !savedViewName.trim()} onClick={() => void saveDirectoryView("update")}>Update view</button><button className="button button-secondary" type="button" disabled={saving || !savedViewName.trim()} onClick={() => void saveDirectoryView("rename")}>Rename</button><button className="button button-secondary" type="button" disabled={saving} onClick={() => void deleteSavedView()}>Delete</button></>}</div>
        <div className="community-group-directory-tools">
          <button className="button button-secondary" type="button" disabled={loading || loadedDepartmentId !== departmentId || visibleGroups.length === 0} onClick={downloadGroupDirectory}><Download size={14} />Export directory CSV</button>
          <label className="community-group-status-filter">Layout
            <select value={displayMode} onChange={(event) => { setDisplayMode(event.target.value === "table" ? "table" : "list"); }}>
              <option value="list">List</option><option value="table">Table</option>
            </select>
          </label>
          {displayMode === "table" && <details>
            <summary>Columns</summary>
            {groupColumns.map(({ key, label }) => <label className="community-group-status-filter" key={key}>
              <input type="checkbox" checked={visibleColumns.includes(key)} onChange={(event) => {
                const isChecked = event.target.checked;
                setVisibleColumns((current) => isChecked ? [...current, key] : current.filter((column) => column !== key));
              }} />{label}
            </label>)}
          </details>}
        </div>
        {canManage && !loading && localVisibleGroups.length > 0 && <details>
          <summary>Change group types in bulk</summary>
          <form className="community-group-form" onSubmit={(event) => void updateSelectedGroupTypes(event)}>
            <label>Groups to update <span className="optional-label">Select up to 100</span>
              <select multiple size={Math.min(6, Math.max(2, localVisibleGroups.length))} value={bulkSelectedIds} disabled={bulkSaving}
                onChange={(event) => setBulkSelection(Array.from(event.target.selectedOptions, (option) => option.value))}>
                {localVisibleGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            </label>
            <label>New type <span className="optional-label">Leave blank to clear</span>
              <input value={bulkType} maxLength={80} disabled={bulkSaving} onChange={(event) => setBulkType(event.target.value)} />
            </label>
            <button className="button button-secondary" type="submit" disabled={bulkSaving || !bulkSelectedIds.length || bulkSelectedIds.length > 100}>
              Update type for {bulkSelectedIds.length} groups
            </button>
          </form>
        </details>}
        {loading ? <p className="community-empty">{translate("groups.loading")}</p> : visibleGroups.length ? displayMode === "table" ? (
          <div className="table-scroll">
            <table className="people-table" aria-label="Groups directory">
              <thead><tr><th scope="col">Group</th>{displayedColumns.map(({ key, label }) => <th scope="col" key={key}>{label}</th>)}</tr></thead>
              <tbody>{pageGroups.map((group) => <tr key={group.id}>
                <td><button type="button" className="button button-secondary" onClick={() => { setSelectedId(group.id); setDetailsGroup(group); }}>{group.name}</button></td>
                {displayedColumns.map(({ key, value }) => <td key={key}>{value(group) ?? "—"}</td>)}
              </tr>)}</tbody>
            </table>
          </div>
        ) : <div className="community-group-options">{pageGroups.map((group) => <button type="button" key={group.id} className={`community-group-option${selectedId === group.id ? " is-active" : ""}`} onClick={() => { setSelectedId(group.id); setDetailsGroup(group); }}><span className="community-group-icon"><ContactRound size={17} /></span><span><strong>{group.name}</strong><small>{group.groupType ? `${group.groupType} · ` : ""}{group.memberCount} {group.memberCount === 1 ? translate("groups.person") : translate("groups.people")} · {group.status}</small></span></button>)}</div> : <p className="community-empty">{((directorySearch || statusFilter !== "all" || groupTypeFilter) ? "No groups match these filters." : translate("groups.none"))}</p>}
        {!loading && loadedDepartmentId === departmentId && directoryPageCount > 1 && <nav className="table-footer" aria-label="Groups directory pages">
          <span aria-live="polite">Showing {directoryOffset + 1}–{directoryOffset + pageGroups.length} of {visibleGroups.length} groups</span>
          <div className="form-actions">
            <button className="button button-secondary" type="button" disabled={directoryPage <= 1} onClick={() => changeDirectoryPage(directoryPage - 1)}>Previous</button>
            <span>Page {directoryPage} of {directoryPageCount}</span>
            <button className="button button-secondary" type="button" disabled={directoryPage >= directoryPageCount} onClick={() => changeDirectoryPage(directoryPage + 1)}>Next</button>
          </div>
        </nav>}
      </section>
      <section className="directory-card community-group-detail">
        {selected ? <>
          <div className="directory-heading"><div><h2>{selected.name}</h2><p>{selected.importedFrom ? translate("groups.importedReadOnly") : selected.description || translate("groups.descriptionFallback")}</p><small className="community-group-lifecycle">{selected.groupType ? `${selected.groupType} · ` : ""}{selected.status}{selected.startsOn ? ` · starts ${formatUserDate(selected.startsOn)}` : ""}{selected.endsOn ? ` · ends ${formatUserDate(selected.endsOn)}` : ""}</small></div>{canManage && !selected.importedFrom && <div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => setEditing((current) => !current)}><Pencil size={14} />{editing ? translate("groups.cancelEdit") : translate("groups.edit")}</button><button className="button button-danger" type="button" onClick={() => void deleteGroup(selected)}><Trash2 size={14} />{translate("groups.delete")}</button></div>}</div>
          {canManage && editing && <form className="community-group-form" onSubmit={saveGroup}><label>{translate("groups.name")}<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label><label>{translate("groups.description")}<textarea rows={2} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} /></label><label>Group type <span className="optional-label">optional</span><input maxLength={80} value={groupType} onChange={(event) => setGroupType(event.target.value)} placeholder="Youth, small group, ministry" /></label><label>Lifecycle status<select value={groupStatus} onChange={(event) => setGroupStatus(event.target.value as GroupLifecycleStatus)}><option value="active">Active</option><option value="draft">Draft</option><option value="ended">Ended</option><option value="archived">Archived</option></select></label><label>Start date <span className="optional-label">optional</span><input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></label><label>End date <span className="optional-label">optional</span><input type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} min={startsOn || undefined} /></label><button className="button button-primary" type="submit" disabled={saving}><Check size={15} />{translate("groups.save")}</button></form>}
          {canManage && !selected.importedFrom && <section className="group-public-signup"><div className="community-members-heading"><div><h3>{translate("groups.publicSignup")}</h3><p>{translate("groups.publicSignupHelp")}</p></div><label className="group-public-signup-toggle"><input type="checkbox" checked={Boolean(selected.publicSignupEnabled)} disabled={signupSaving || selected.status !== "active"} onChange={(event) => void setPublicSignupEnabled(event.target.checked)} /><span>{selected.publicSignupEnabled ? translate("groups.enabled") : translate("groups.off")}</span></label></div>{selected.status !== "active" && <p className="community-empty">Public signup is available for active groups only.</p>}{selected.publicSignupEnabled && selected.publicSignupToken && <div className="group-public-signup-link"><code>{window.location.origin}/join-group/{selected.publicSignupToken}</code><button className="button button-secondary" type="button" onClick={() => void copyGroupSignupLink(selected)}><Link2 size={14} />{translate("groups.copyLink")}</button></div>}</section>}
          {canManage && !selected.importedFrom && loadedDepartmentId === departmentId && <GroupTypeHistory key={departmentId + ":" + selected.id} departmentId={departmentId} groupId={selected.id} groupType={selected.groupType} />}
          {canManage && !selected.importedFrom && <section className="group-join-requests"><div className="community-members-heading"><div><h3>{translate("groups.joinRequests")}</h3><p>{translate("groups.waitingReview").replace("{count}", String(joinRequests.length))}</p></div></div>{joinRequests.length ? <div className="group-join-request-list">{joinRequests.map((joinRequest) => {
            const matches = contacts.filter((person) => person.email?.trim().toLocaleLowerCase() === joinRequest.email.toLocaleLowerCase());
            return <article className="group-join-request" key={joinRequest.id}><div><strong>{joinRequest.firstName} {joinRequest.lastName}</strong><small>{joinRequest.email} · {formatUserDate(joinRequest.createdAt, true)}</small></div>{matches.length > 1 && <label>{translate("groups.matchPerson")}<select value={requestContactIds[joinRequest.id] ?? ""} onChange={(event) => setRequestContactIds((current) => ({ ...current, [joinRequest.id]: event.target.value }))}><option value="">{translate("groups.choosePerson")}</option>{matches.map((person) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>)}</select></label>}{matches.length === 0 && <small>{translate("groups.approvalCreatesVisitor")}</small>}<div className="group-join-request-actions"><button className="button button-secondary" type="button" disabled={saving} onClick={() => void reviewJoinRequest(joinRequest, "declined")}>{translate("groups.decline")}</button><button className="button button-primary" type="button" disabled={saving || matches.length > 1 && !requestContactIds[joinRequest.id]} onClick={() => void reviewJoinRequest(joinRequest, "approved")}><Check size={14} />{translate("groups.approve")}</button></div></article>;
          })}</div> : <p className="community-empty">{translate("groups.noJoinRequests")}</p>}</section>}
          <div className="community-members-heading"><div><h3>{translate("groups.members")}</h3><p>{translate("groups.personCount").replace("{count}", String(selected.memberCount))}{selected.importedFrom ? translate("groups.managedInChurchTools") : ""}</p></div>{canManage && !selected.importedFrom && <button className="button button-primary" type="button" disabled={saving || memberDraft.length === selected.memberIds.length && memberDraft.every((id) => selected.memberIds.includes(id))} onClick={() => void saveMembers()}><Check size={15} />{translate("groups.saveMembers")}</button>}</div>
          {canManage && !selected.importedFrom && <label className="search-field community-member-search"><Search size={15} /><input aria-label={translate("groups.searchPeople")} placeholder={translate("groups.searchPeople")} value={query} onChange={(event) => setQuery(event.target.value)} /></label>}
          {selected.importedFrom ? <p className="community-empty">{translate("groups.importedMemberships")}</p> : contacts.length ? <div className="community-member-list">{visibleContacts.map((person) => {
            const isMember = memberDraft.includes(person.id);
            const details = memberDetailsDraft[person.id] ?? { role: "Member", status: "active" as const };
            return <div className="community-member-row group-member-details-row" key={person.id}><input type="checkbox" aria-label={(isMember ? translate("groups.removePerson") : translate("groups.addPerson")).replace("{name}", `${person.firstName} ${person.lastName}`)} checked={isMember} disabled={!canManage} onChange={(event) => {
              if (event.target.checked) {
                setMemberDraft((current) => [...current, person.id]);
                setMemberDetailsDraft((current) => ({ ...current, [person.id]: current[person.id] ?? { role: "Member", status: "active" } }));
              } else setMemberDraft((current) => current.filter((id) => id !== person.id));
            }} /><span className="community-member-avatar">{person.firstName[0]}{person.lastName[0]}</span><span className="group-member-person"><strong>{person.firstName} {person.lastName}</strong><small>{person.status === "member" ? translate("groups.member") : translate("groups.visitor")}</small></span>{isMember && <div className="group-membership-controls">{canManage ? <><input aria-label={translate("groups.roleFor").replace("{name}", `${person.firstName} ${person.lastName}`)} maxLength={80} value={details.role} onChange={(event) => setMemberDetailsDraft((current) => ({ ...current, [person.id]: { ...details, role: event.target.value } }))} /><select aria-label={translate("groups.statusFor").replace("{name}", `${person.firstName} ${person.lastName}`)} value={details.status} onChange={(event) => setMemberDetailsDraft((current) => ({ ...current, [person.id]: { ...details, status: event.target.value as typeof details.status } }))}><option value="active">{translate("groups.active")}</option><option value="paused">{translate("groups.paused")}</option><option value="waitlist">{translate("groups.waitlist")}</option></select><input type="date" aria-label={translate("groups.joinDateFor").replace("{name}", `${person.firstName} ${person.lastName}`)} value={details.joinedOn ?? ""} onChange={(event) => setMemberDetailsDraft((current) => ({ ...current, [person.id]: { ...details, joinedOn: event.target.value || undefined } }))} /></> : <small>{details.role} · {details.status}</small>}</div>}</div>;
          })}</div> : <p className="community-empty">{translate("groups.addPeopleFirst")}</p>}
          {!selected.importedFrom && <section className="group-attendance-section" aria-labelledby="group-attendance-title">
            <div className="community-members-heading"><div><h3 id="group-attendance-title">{translate("groups.attendance")}</h3><p>{translate("groups.attendanceHelp")}</p></div></div>
            {canManage && <form className="group-meeting-form" onSubmit={(event) => void createMeeting(event)}><label>{translate("groups.meetingDate")}<input type="date" required value={meetingDate} onChange={(event) => setMeetingDate(event.target.value)} /></label><label>{translate("groups.meetingName")} <span className="optional-label">{translate("groups.optional")}</span><input maxLength={160} value={meetingTitle} onChange={(event) => setMeetingTitle(event.target.value)} placeholder={translate("groups.meetingNameExample")} /></label><button className="button button-primary" type="submit" disabled={saving || memberListChanged}><Plus size={15} />{translate("groups.createMeeting")}</button>{memberListChanged && <small className="group-meeting-help">{translate("groups.saveRosterFirst")}</small>}</form>}
            {meetings.length > 0 && <label className="group-meeting-picker">{translate("groups.meeting")}<select value={activeMeetingId} onChange={(event) => setActiveMeetingId(event.target.value)}><option value="">{translate("groups.chooseMeeting")}</option>{meetings.map((meeting) => <option key={meeting.id} value={meeting.id}>{formatUserDate(meeting.date)} {meeting.title ? `· ${meeting.title}` : ""} · {translate("groups.meetingAttendanceSummary").replace("{present}", String(meeting.presentCount)).replace("{total}", String(meeting.attendeeCount))}</option>)}</select></label>}
            {activeMeetingId && <><div className="group-attendance-heading"><strong>{translate("groups.presentCount").replace("{count}", String(attendance.length))}</strong><div className="community-inline-actions">{canManage && attendance.length > 0 && <button className="button button-secondary" type="button" onClick={downloadGroupAttendance}><Download size={14} />{translate("events.exportAttendance")}</button>}{canManage && <button className="button button-primary" type="button" onClick={() => void saveAttendance()} disabled={attendanceSaving || attendanceLoading}><Check size={14} />{attendanceSaving ? translate("settings.personal.saving") : translate("groups.saveAttendance")}</button>}</div></div>{attendanceLoading ? <p className="community-empty">{translate("groups.loading")}</p> : attendance.length ? <div className="group-attendance-list">{attendance.map((entry) => <label className="community-member-row" key={entry.contactId}><span className="community-member-avatar">{entry.firstName[0]}{entry.lastName[0]}</span><span><strong>{entry.firstName} {entry.lastName}</strong></span><select aria-label={translate("groups.attendanceFor").replace("{name}", `${entry.firstName} ${entry.lastName}`)} disabled={!canManage} value={entry.status} onChange={(event) => setAttendance((current) => current.map((person) => person.contactId === entry.contactId ? { ...person, status: event.target.value as AttendanceEntry["status"] } : person))}><option value="present">{translate("groups.present")}</option><option value="absent">{translate("groups.absent")}</option><option value="excused">{translate("groups.excused")}</option></select></label>)}</div> : <p className="community-empty">{translate("groups.noRoster")}</p>}</>}
            {!meetings.length && !canManage && <p className="community-empty">{translate("groups.noMeetings")}</p>}
          </section>}
        </> : canManage ? <form className="community-new-group" onSubmit={saveGroup}><span className="community-group-icon"><ContactRound size={20} /></span><h2>{translate("groups.createStart")}</h2><p>{translate("groups.createStartHelp")}</p><label>{translate("groups.name")}<input autoFocus required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder={translate("groups.groupNameExample")} /></label><label>{translate("groups.description")} <span className="optional-label">{translate("groups.optional")}</span><textarea rows={3} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={translate("groups.whoBelongs")} /></label><label>Group type <span className="optional-label">optional</span><input maxLength={80} value={groupType} onChange={(event) => setGroupType(event.target.value)} placeholder="Youth, small group, ministry" /></label><label>Lifecycle status<select value={groupStatus} onChange={(event) => setGroupStatus(event.target.value as GroupLifecycleStatus)}><option value="active">Active</option><option value="draft">Draft</option><option value="ended">Ended</option><option value="archived">Archived</option></select></label><label>Start date <span className="optional-label">optional</span><input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></label><label>End date <span className="optional-label">optional</span><input type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} min={startsOn || undefined} /></label><button className="button button-primary" type="submit" disabled={saving || !name.trim()}><Plus size={16} />{translate("groups.create")}</button></form> : <p className="community-empty">{translate("groups.selectHint")}</p>}
      </section>
    </section>
    {detailsGroup && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDetailsGroup(null)}><section className="modal item-details-modal" role="dialog" aria-modal="true" aria-labelledby="group-details-title"><div className="modal-heading"><div><span className="eyebrow">{translate("groups.eyebrow")}</span><h2 id="group-details-title">{detailsGroup.name}</h2><p>{detailsGroup.groupType ? `${detailsGroup.groupType} · ` : ""}{detailsGroup.importedFrom ? translate("groups.importedReadOnly") : translate("groups.personCount").replace("{count}", String(detailsGroup.memberCount))}</p></div><button className="icon-button" type="button" aria-label={translate("events.closeDialog")} onClick={() => setDetailsGroup(null)}>×</button></div><dl className="event-details-grid"><div><dt>Group type</dt><dd>{detailsGroup.groupType || "Not set"}</dd></div><div><dt>{translate("groups.members")}</dt><dd>{detailsGroup.memberCount}</dd></div><div><dt>{translate("groups.description")}</dt><dd>{detailsGroup.description || translate("groups.descriptionFallback")}</dd></div></dl>{detailsGroup.memberIds.length > 0 && <section className="event-details-section"><h3>{translate("groups.members")}</h3><ul>{detailsGroup.memberIds.map((id) => { const person = contacts.find((contact) => contact.id === id); return person ? <li key={id}><strong>{person.firstName} {person.lastName}</strong><span>{person.status === "member" ? translate("groups.member") : translate("groups.visitor")}</span></li> : null; })}</ul></section>}<div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setDetailsGroup(null)}>{translate("events.close")}</button><button className="button button-primary" type="button" onClick={() => { setSelectedId(detailsGroup.id); setDetailsGroup(null); }}>{translate("groups.edit")}</button></div></section></div>}
    <footer className="page-footer"><span>{translate("groups.footer")}</span><span>© 2026 Smart Church</span></footer>
  </>;
}
