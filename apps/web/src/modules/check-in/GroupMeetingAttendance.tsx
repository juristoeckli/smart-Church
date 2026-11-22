import { useEffect, useState, type FormEvent } from "react";
import { Plus, Search } from "lucide-react";
import "./module.css";
import { translate } from "../../i18n";
import { GroupMeetingAddAttendee } from "./GroupMeetingAddAttendee";
import { GroupMeetingCompletion } from "../../GroupMeetingCompletion";
import { groupAttendanceChanges, groupAttendanceUrl, setGroupAttendanceCompletion, type CompletionFeedbackDraft, type GroupAttendanceSnapshot, type GroupAttendanceStatus } from "../../group-attendance";

type Group = { id: string; name: string; status: string; importedFrom?: string };
type Meeting = { id: string; date: string; title: string; completedAt?: string | null };
export type GroupMeetingTarget = Meeting & { groupId: string };
const statuses = { present: "Present", absent: "Absent", excused: "Excused" } as const;
const statusKeys = Object.keys(statuses) as GroupAttendanceStatus[];

function useData<T>(path: string, departmentId: string, label: string) {
  const [result, setResult] = useState<{ path: string; data?: T; error?: string }>();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    const fallback = "Could not load " + label + ".";
    void fetch(path, { headers: { "x-department-id": departmentId }, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(fallback);
        const data = await response.json() as T;
        if (!controller.signal.aborted) setResult({ path, data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ path, error: fallback });
      });
    return () => controller.abort();
  }, [path, departmentId, label, version]);
  return {
    data: path && result?.path === path ? result.data : undefined,
    error: path && result?.path === path ? result.error : undefined,
    pending: Boolean(path && result?.path !== path),
    reload: () => { setResult(undefined); setVersion((current) => current + 1); },
  };
}

export function GroupMeetingAttendance({ departmentId, csrfToken, onBack, target }: {
  departmentId: string;
  csrfToken: string;
  onBack: () => void;
  target?: GroupMeetingTarget;
}) {
  const [groupId, selectGroup] = useState("");
  const groups = useData<Group[]>(target ? "" : "/api/groups", departmentId, "groups");
  const localGroups = (groups.data ?? []).filter((group) => !group.importedFrom);
  const group = localGroups.find((value) => value.id === groupId);
  const meetings = useData<Meeting[]>(group ? "/api/groups/" + group.id + "/meetings" : "", departmentId, "group meetings");
  const [meetingId, selectMeeting] = useState("");
  const availableMeetings = meetings.data ?? [];
  const meeting = target ?? availableMeetings.find((value) => value.id === meetingId);
  const roster = useData<GroupAttendanceSnapshot>(meeting ? groupAttendanceUrl(meeting.id) + "?withCompletion=true" : "", departmentId, "attendance");
  const [newMeetingOpen, setNewMeetingOpen] = useState(false);
  const [newMeetingDate, setNewMeetingDate] = useState("");
  const [newMeetingTitle, setNewMeetingTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Record<string, GroupAttendanceStatus>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<GroupAttendanceStatus | "">("");
  const [roleFilter, setRoleFilter] = useState("");
  const [sortBy, setSortBy] = useState<"lastName" | "firstName">("lastName");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const attendance = roster.data?.attendance ?? [];
  const completedAt = roster.data?.completedAt ?? null;
  const rows = attendance.map((row) => ({ ...row, status: draft[row.contactId] ?? row.status }));
  const changes = groupAttendanceChanges(attendance, rows);
  const busy = saving || creating || changes.length > 0;
  const term = query.trim().toLocaleLowerCase();
  const names = new Intl.Collator(document.documentElement.lang || undefined, { sensitivity: "base" });
  const roles = [...new Set(rows.map((row) => row.role?.trim()).filter((role): role is string => Boolean(role)))].sort(names.compare);
  const activeRole = roles.includes(roleFilter) ? roleFilter : "";
  const secondName = sortBy === "lastName" ? "firstName" : "lastName";
  const shown = rows.filter((row) => (!filter || row.status === filter)
    && (!activeRole || row.role?.trim() === activeRole)
    && (row.firstName + " " + row.lastName).toLocaleLowerCase().includes(term))
    .sort((left, right) => names.compare(left[sortBy], right[sortBy]) || names.compare(left[secondName], right[secondName]));
  const loadError = groups.error ?? meetings.error ?? roster.error;
  const pending = groups.pending || meetings.pending || roster.pending;

  function resetDraft() {
    setDraft({});
    setError("");
    setNotice("");
  }

  async function createMeeting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (target || group?.status !== "active" || busy || !newMeetingDate) return;
    setCreating(true);
    resetDraft();
    try {
      const response = await fetch("/api/groups/" + group.id + "/meetings", {
        method: "POST",
        headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify({ date: newMeetingDate, title: newMeetingTitle.trim() }),
      });
      const created = await response.json() as Meeting | { error?: string };
      if (!response.ok || !("id" in created)) throw new Error("error" in created && created.error ? created.error : "Could not open the group meeting.");
      selectMeeting(created.id);
      setNewMeetingOpen(false);
      setNewMeetingDate("");
      setNewMeetingTitle("");
      setQuery("");
      setFilter("");
      setRoleFilter("");
      meetings.reload();
      roster.reload();
      setNotice(response.status === 201 ? "Meeting created. The attendance roster is ready to open." : "Existing meeting opened.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not open the group meeting.");
    } finally {
      setCreating(false);
    }
  }

  async function saveAttendance() {
    if (!meeting || !roster.data || completedAt || saving || !changes.length) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(groupAttendanceUrl(meeting.id), {
        method: "PUT",
        headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify({ attendance: changes }),
      });
      const result = await response.json() as { saved?: boolean; error?: string };
      if (!response.ok || !result.saved) throw new Error(result.error ?? "Could not save attendance.");
      setDraft({});
      setNotice("Attendance saved.");
      roster.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save attendance.");
    } finally {
      setSaving(false);
    }
  }

  async function changeMeetingCompletion(feedback?: CompletionFeedbackDraft) {
    if (!meeting || !roster.data || saving || changes.length) return false;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const updated = await setGroupAttendanceCompletion(meeting.id, departmentId, csrfToken, completedAt, feedback);
      if (!updated) setNotice("Attendance reopened.");
      if (!target) meetings.reload();
      roster.reload();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not change group meeting completion.");
      if (!feedback) roster.reload();
      return false;
    } finally {
      setSaving(false);
    }
  }

  return <main className="checkin-module">
    <header className="checkin-heading">
      <div><h1>Group meeting attendance</h1>{target && <p>{target.date} · {target.title}</p>}</div>
      <button className="checkin-print" disabled={busy} type="button" onClick={onBack}>{target ? "Back to Calendar" : "Back to service check-in"}</button>
    </header>
    {!target && <section className="checkin-setup">
      <label>Group<select value={groupId} disabled={busy || groups.pending} onChange={(event) => {
        selectGroup(event.target.value);
        selectMeeting("");
        setNewMeetingOpen(false);
        setNewMeetingDate("");
        setNewMeetingTitle("");
        meetings.reload();
        roster.reload();
        resetDraft();
      }}>
        <option value="">Select a group…</option>
        {localGroups.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}
      </select></label>
      <label>Group meeting<select value={meetingId} disabled={busy || !group || meetings.pending} onChange={(event) => {
        selectMeeting(event.target.value);
        roster.reload();
        setQuery("");
        setFilter("");
        setRoleFilter("");
        resetDraft();
      }}>
        <option value="">Select a group meeting…</option>
        {availableMeetings.map((value) => <option key={value.id} value={value.id}>{value.date}{value.title ? " · " + value.title : ""}{value.completedAt ? " · completed" : ""}</option>)}
      </select></label>
    </section>}
    {!target && group?.status === "active" && <section className="checkin-toolbar">
      <button type="button" className="checkin-print" disabled={busy || meetings.pending}
        aria-expanded={newMeetingOpen} onClick={() => { setNewMeetingOpen(!newMeetingOpen); setError(""); }}>
        <Plus size={15} /> {translate("groups.createMeeting")}
      </button>
      {newMeetingOpen && <form className="group-meeting-form" onSubmit={(event) => void createMeeting(event)}>
        <label>{translate("groups.meetingDate")}<input type="date" required value={newMeetingDate} disabled={creating}
          onChange={(event) => setNewMeetingDate(event.target.value)} /></label>
        <label>{translate("groups.meetingName")}<input type="text" maxLength={160} value={newMeetingTitle} disabled={creating}
          onChange={(event) => setNewMeetingTitle(event.target.value)} /></label>
        <button type="submit" className="checkin-print" disabled={busy || !newMeetingDate}>
          {creating ? translate("events.saving") : translate("groups.createMeeting")}
        </button>
      </form>}
    </section>}
    {(error || loadError) && <p className="checkin-error" role="alert">{error || loadError}</p>}
    {notice && <p role="status">{notice}</p>}
    {loadError && <button className="checkin-print" type="button" onClick={groups.error ? groups.reload : meetings.error ? meetings.reload : roster.reload}>Retry</button>}
    {pending && <p className="checkin-empty" role="status">Loading…</p>}
    {!pending && !loadError && group && !availableMeetings.length && <p className="checkin-empty">No meetings have been created for this group.</p>}
    {!pending && !loadError && meeting && <>
      <section className="checkin-toolbar">
        <strong>{statusKeys.map((status) => rows.filter((row) => row.status === status).length + " " + statuses[status].toLowerCase()).join(" · ")}</strong>
        <label className="checkin-search"><Search size={17}/><span className="sr-only">Find attendee</span><input type="search" placeholder="Find attendee" value={query} onChange={(event) => setQuery(event.target.value)}/></label>
        <label className="checkin-sort">Status<select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
          <option value="">All</option>
          {statusKeys.map((status) => <option key={status} value={status}>{statuses[status]}</option>)}
        </select></label>
        <label className="checkin-sort">Sort by<select value={sortBy} onChange={(event) => setSortBy(event.target.value === "firstName" ? "firstName" : "lastName")}>
          <option value="lastName">Last name</option>
          <option value="firstName">First name</option>
        </select></label>
        {roles.length > 0 && <label className="checkin-sort">Group role<select value={activeRole} onChange={(event) => setRoleFilter(event.target.value)}>
          <option value="">All roles</option>
          {roles.map((role) => <option key={role} value={role}>{role}</option>)}
        </select></label>}
        <button className="checkin-print" type="button" disabled={saving} onClick={() => { resetDraft(); roster.reload(); }}>
          {changes.length ? "Discard changes and reload" : "Reload attendance"}
        </button>
        {completedAt && <strong>Attendance completed.</strong>}
        <GroupMeetingCompletion key={departmentId + ":" + meeting.id} meetingId={meeting.id} departmentId={departmentId} completedAt={completedAt} disabled={saving || Boolean(changes.length)} buttonClass="checkin-print" onComplete={changeMeetingCompletion} />
        <button className="checkin-print" type="button" disabled={saving || Boolean(completedAt) || !changes.length} onClick={() => void saveAttendance()}>{saving ? "Saving…" : "Save attendance"}</button>
      </section>
      {roster.data?.canAddAttendees && <GroupMeetingAddAttendee key={departmentId + ":" + meeting.id}
        meetingId={meeting.id} departmentId={departmentId} csrfToken={csrfToken} disabled={busy} onChanged={(joinedGroup) => {
          setQuery("");
          setFilter("");
          setRoleFilter("");
          roster.reload();
          setNotice(joinedGroup ? "Person added to the group and marked present." : "Person marked present for this meeting.");
        }} />}
      <div className="checkin-roster">
        {shown.map((row) => <article className={"checkin-person" + (row.status === "present" ? " is-present" : "")} key={row.contactId}>
          <div className="checkin-person-info"><strong>{row.firstName} {row.lastName}</strong>{row.role && <span>{row.role}</span>}</div>
          <select aria-label={"Attendance for " + row.firstName + " " + row.lastName} value={row.status} disabled={saving || Boolean(completedAt)} onChange={(event) => {
            const status = event.target.value as GroupAttendanceStatus;
            setDraft((current) => ({ ...current, [row.contactId]: status }));
            setNotice("");
          }}>
            {statusKeys.map((status) => <option key={status} value={status}>{statuses[status]}</option>)}
          </select>
        </article>)}
        {!shown.length && <p className="checkin-empty">{rows.length ? "No attendees match this view." : "This meeting has no saved roster."}</p>}
      </div>
    </>}
  </main>;
}
