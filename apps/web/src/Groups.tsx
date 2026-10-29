import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, ContactRound, Pencil, Plus, Search, Trash2 } from "lucide-react";
import type { ChurchGroup, Contact } from "@smart-church/contracts";

type GroupMeeting = { id: string; date: string; title: string; attendeeCount: number; presentCount: number };
type AttendanceEntry = { contactId: string; firstName: string; lastName: string; status: "present" | "absent" | "excused" };

export function Groups({ departmentId, contacts, canManage }: { departmentId: string; contacts: Contact[]; canManage: boolean }) {
  const [groups, setGroups] = useState<ChurchGroup[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [memberDraft, setMemberDraft] = useState<string[]>([]);
  const [memberDetailsDraft, setMemberDetailsDraft] = useState<Record<string, { role: string; status: "active" | "paused" | "waitlist"; joinedOn?: string }>>({});
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [meetings, setMeetings] = useState<GroupMeeting[]>([]);
  const [meetingDate, setMeetingDate] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10));
  const [meetingTitle, setMeetingTitle] = useState("");
  const [activeMeetingId, setActiveMeetingId] = useState("");
  const [attendance, setAttendance] = useState<AttendanceEntry[]>([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceSaving, setAttendanceSaving] = useState(false);
  const selected = groups.find((group) => group.id === selectedId) ?? null;
  const memberListChanged = Boolean(selected && (
    memberDraft.length !== selected.memberIds.length || memberDraft.some((id) => !selected.memberIds.includes(id)) ||
    memberDraft.some((id) => {
      const draft = memberDetailsDraft[id];
      const saved = selected.memberDetails?.find((item) => item.contactId === id);
      return !draft || !saved || draft.role !== saved.role || draft.status !== saved.status || draft.joinedOn !== saved.joinedOn;
    })
  ));

  async function loadGroups(signal?: AbortSignal) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/groups", { headers: { "x-department-id": departmentId }, signal });
      const result = await response.json() as ChurchGroup[] | { error?: string };
      if (!response.ok || !Array.isArray(result)) throw new Error(!Array.isArray(result) ? result.error ?? "Could not load groups." : "Could not load groups.");
      setGroups(result);
      setSelectedId((current) => result.some((group) => group.id === current) ? current : result[0]?.id ?? "");
    } catch (reason) { if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "Could not load groups."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadGroups(controller.signal);
    return () => controller.abort();
  }, [departmentId]);

  useEffect(() => {
    if (!selected) { setName(""); setDescription(""); setMemberDraft([]); setEditing(false); return; }
    setName(selected.name);
    setDescription(selected.description);
    setMemberDraft(selected.memberIds);
    setMemberDetailsDraft(Object.fromEntries((selected.memberDetails ?? []).map((member) => [member.contactId, { role: member.role, status: member.status, joinedOn: member.joinedOn }])));
    setEditing(false);
  }, [selectedId, selected?.name, selected?.description, selected?.memberIds.join(",")]);

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
        body: JSON.stringify({ name, description }),
      });
      const result = await response.json() as ChurchGroup | { error?: string };
      if (!response.ok || !("id" in result)) throw new Error("error" in result ? result.error ?? "Could not save the group." : "Could not save the group.");
      if (editing) setGroups((current) => current.map((group) => group.id === result.id ? result : group));
      else { setGroups((current) => [...current, result].sort((a, b) => a.name.localeCompare(b.name))); setSelectedId(result.id); }
      setEditing(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the group."); }
    finally { setSaving(false); }
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

  async function deleteGroup(group: ChurchGroup) {
    if (!window.confirm(`Delete the group “${group.name}”? People in the group will remain in the directory.`)) return;
    try {
      const response = await fetch(`/api/groups/${group.id}`, { method: "DELETE", headers: { "x-department-id": departmentId } });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not delete the group.");
      setGroups((current) => current.filter((item) => item.id !== group.id));
      if (selectedId === group.id) setSelectedId(groups.find((item) => item.id !== group.id)?.id ?? "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete the group."); }
  }

  return <>
    <div className={`demo-notice ${error ? "demo-notice-error" : ""}`}><span className="demo-dot" />{error || `Groups help people connect at ${departmentId ? "your church" : "this site"}`}{error && <button className="event-retry" type="button" onClick={() => void loadGroups()}>Try again</button>}</div>
    <section className="page-heading"><div><div className="eyebrow">CHURCH COMMUNITY</div><h1>Groups</h1><p className="page-subtitle">Organize congregations and communities, such as the regular service, youth church, and other groups.</p></div>{canManage && <button className="button button-primary" type="button" onClick={() => { setSelectedId(""); setName(""); setDescription(""); setEditing(false); }}><Plus size={17} /> New group</button>}</section>
    <section className="community-groups-layout">
      <section className="directory-card community-group-list"><div className="directory-heading"><div><h2>Church groups</h2><p>{groups.length} {groups.length === 1 ? "group" : "groups"}</p></div></div>
        {loading ? <p className="community-empty">Loading groups…</p> : groups.length ? <div className="community-group-options">{groups.map((group) => <button type="button" key={group.id} className={`community-group-option${selectedId === group.id ? " is-active" : ""}`} onClick={() => setSelectedId(group.id)}><span className="community-group-icon"><ContactRound size={17} /></span><span><strong>{group.name}</strong><small>{group.memberCount} {group.memberCount === 1 ? "person" : "people"}</small></span></button>)}</div> : <p className="community-empty">No groups yet. Create one to get started.</p>}
      </section>
      <section className="directory-card community-group-detail">
        {selected ? <>
          <div className="directory-heading"><div><h2>{selected.name}</h2><p>{selected.importedFrom === "churchtools" ? "Imported from ChurchTools · read-only" : selected.description || "Add a short description for this group."}</p></div>{canManage && !selected.importedFrom && <div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => setEditing((current) => !current)}><Pencil size={14} />{editing ? "Cancel edit" : "Edit group"}</button><button className="button button-danger" type="button" onClick={() => void deleteGroup(selected)}><Trash2 size={14} />Delete</button></div>}</div>
          {canManage && editing && <form className="community-group-form" onSubmit={saveGroup}><label>Group name<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label><label>Description<textarea rows={2} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} /></label><button className="button button-primary" type="submit" disabled={saving}><Check size={15} />Save group</button></form>}
          <div className="community-members-heading"><div><h3>Group members</h3><p>{selected.memberCount} people{selected.importedFrom === "churchtools" ? " · managed in ChurchTools" : ""}</p></div>{canManage && !selected.importedFrom && <button className="button button-primary" type="button" disabled={saving || memberDraft.length === selected.memberIds.length && memberDraft.every((id) => selected.memberIds.includes(id))} onClick={() => void saveMembers()}><Check size={15} />Save members</button>}</div>
          {canManage && !selected.importedFrom && <label className="search-field community-member-search"><Search size={15} /><input aria-label="Search people to add to group" placeholder="Search people…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>}
          {selected.importedFrom ? <p className="community-empty">Membership details for imported groups are managed in ChurchTools.</p> : contacts.length ? <div className="community-member-list">{visibleContacts.map((person) => {
            const isMember = memberDraft.includes(person.id);
            const details = memberDetailsDraft[person.id] ?? { role: "Member", status: "active" as const };
            return <div className="community-member-row group-member-details-row" key={person.id}><input type="checkbox" aria-label={`${isMember ? "Remove" : "Add"} ${person.firstName} ${person.lastName} ${isMember ? "from" : "to"} group`} checked={isMember} disabled={!canManage} onChange={(event) => {
              if (event.target.checked) {
                setMemberDraft((current) => [...current, person.id]);
                setMemberDetailsDraft((current) => ({ ...current, [person.id]: current[person.id] ?? { role: "Member", status: "active" } }));
              } else setMemberDraft((current) => current.filter((id) => id !== person.id));
            }} /><span className="community-member-avatar">{person.firstName[0]}{person.lastName[0]}</span><span className="group-member-person"><strong>{person.firstName} {person.lastName}</strong><small>{person.status === "member" ? "Member" : "Visitor"}</small></span>{isMember && <div className="group-membership-controls">{canManage ? <><input aria-label={`Role of ${person.firstName} ${person.lastName}`} maxLength={80} value={details.role} onChange={(event) => setMemberDetailsDraft((current) => ({ ...current, [person.id]: { ...details, role: event.target.value } }))} /><select aria-label={`Membership status of ${person.firstName} ${person.lastName}`} value={details.status} onChange={(event) => setMemberDetailsDraft((current) => ({ ...current, [person.id]: { ...details, status: event.target.value as typeof details.status } }))}><option value="active">Active</option><option value="paused">Paused</option><option value="waitlist">Waitlist</option></select><input type="date" aria-label={`Join date of ${person.firstName} ${person.lastName}`} value={details.joinedOn ?? ""} onChange={(event) => setMemberDetailsDraft((current) => ({ ...current, [person.id]: { ...details, joinedOn: event.target.value || undefined } }))} /></> : <small>{details.role} · {details.status}</small>}</div>}</div>;
          })}</div> : <p className="community-empty">Add people in the People section before assigning group members.</p>}
          {!selected.importedFrom && <section className="group-attendance-section" aria-labelledby="group-attendance-title">
            <div className="community-members-heading"><div><h3 id="group-attendance-title">Meetings &amp; attendance</h3><p>Keep a dated record of who attended each group meeting.</p></div></div>
            {canManage && <form className="group-meeting-form" onSubmit={(event) => void createMeeting(event)}><label>Meeting date<input type="date" required value={meetingDate} onChange={(event) => setMeetingDate(event.target.value)} /></label><label>Meeting name <span className="optional-label">Optional</span><input maxLength={160} value={meetingTitle} onChange={(event) => setMeetingTitle(event.target.value)} placeholder="e.g. Sunday morning" /></label><button className="button button-primary" type="submit" disabled={saving || memberListChanged}><Plus size={15} />Create meeting</button>{memberListChanged && <small className="group-meeting-help">Save the updated group roster before creating its meeting.</small>}</form>}
            {meetings.length > 0 && <label className="group-meeting-picker">Meeting<select value={activeMeetingId} onChange={(event) => setActiveMeetingId(event.target.value)}><option value="">Choose a meeting…</option>{meetings.map((meeting) => <option key={meeting.id} value={meeting.id}>{new Date(`${meeting.date}T12:00:00`).toLocaleDateString()} {meeting.title ? `· ${meeting.title}` : ""} · {meeting.presentCount}/{meeting.attendeeCount} present</option>)}</select></label>}
            {activeMeetingId && <><div className="group-attendance-heading"><strong>{attendance.length} people on the meeting roster</strong>{canManage && <button className="button button-primary" type="button" onClick={() => void saveAttendance()} disabled={attendanceSaving || attendanceLoading}><Check size={14} />{attendanceSaving ? "Saving…" : "Save attendance"}</button>}</div>{attendanceLoading ? <p className="community-empty">Loading attendance…</p> : attendance.length ? <div className="group-attendance-list">{attendance.map((entry) => <label className="community-member-row" key={entry.contactId}><span className="community-member-avatar">{entry.firstName[0]}{entry.lastName[0]}</span><span><strong>{entry.firstName} {entry.lastName}</strong></span><select aria-label={`Attendance for ${entry.firstName} ${entry.lastName}`} disabled={!canManage} value={entry.status} onChange={(event) => setAttendance((current) => current.map((person) => person.contactId === entry.contactId ? { ...person, status: event.target.value as AttendanceEntry["status"] } : person))}><option value="present">Present</option><option value="absent">Absent</option><option value="excused">Excused</option></select></label>)}</div> : <p className="community-empty">No members were on the roster when this meeting was created.</p>}</>}
            {!meetings.length && !canManage && <p className="community-empty">No meetings have been recorded yet.</p>}
          </section>}
        </> : canManage ? <form className="community-new-group" onSubmit={saveGroup}><span className="community-group-icon"><ContactRound size={20} /></span><h2>Create a group</h2><p>Give the group a name, then add people from your directory.</p><label>Group name<input autoFocus required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Regular service or Youth church" /></label><label>Description <span className="optional-label">Optional</span><textarea rows={3} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Who belongs to this group?" /></label><button className="button button-primary" type="submit" disabled={saving || !name.trim()}><Plus size={16} />Create group</button></form> : <p className="community-empty">Select a group to see its members.</p>}
      </section>
    </section>
    <footer className="page-footer"><span>Every person has a place to belong.</span><span>© 2026 Smart Church</span></footer>
  </>;
}
