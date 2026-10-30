import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, ContactRound, Link2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import type { ChurchGroup, Contact } from "@smart-church/contracts";
import { formatUserDate } from "./date-format";
import { getActiveLanguage, translate } from "./i18n";
import { translateModuleMessage } from "./modules/translations";

type GroupMeeting = { id: string; date: string; title: string; attendeeCount: number; presentCount: number };
type AttendanceEntry = { contactId: string; firstName: string; lastName: string; status: "present" | "absent" | "excused" };
type GroupJoinRequest = { id: string; groupId: string; firstName: string; lastName: string; email: string; status: "pending"; createdAt: string };

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
    <section className="page-heading"><div><div className="eyebrow">{translate("groups.eyebrow")}</div><h1>{translate("groups.title")}</h1><p className="page-subtitle">{translate("groups.subtitle")}</p></div>{canManage && <button className="button button-primary" type="button" onClick={() => { setSelectedId(""); setName(""); setDescription(""); setEditing(false); }}><Plus size={17} />{" "}{translate("groups.new")}</button>}</section>
    <section className="community-groups-layout">
      <section className="directory-card community-group-list"><div className="directory-heading"><div><h2>{translate("groups.listTitle")}</h2><p>{(groups.length === 1 ? translate("groups.countOne") : translate("groups.count")).replace("{count}", String(groups.length))}</p></div></div>
        {loading ? <p className="community-empty">{translate("groups.loading")}</p> : groups.length ? <div className="community-group-options">{groups.map((group) => <button type="button" key={group.id} className={`community-group-option${selectedId === group.id ? " is-active" : ""}`} onClick={() => setSelectedId(group.id)}><span className="community-group-icon"><ContactRound size={17} /></span><span><strong>{group.name}</strong><small>{group.memberCount} {group.memberCount === 1 ? translate("groups.person") : translate("groups.people")}</small></span></button>)}</div> : <p className="community-empty">{translate("groups.none")}</p>}
      </section>
      <section className="directory-card community-group-detail">
        {selected ? <>
          <div className="directory-heading"><div><h2>{selected.name}</h2><p>{selected.importedFrom ? translate("groups.importedReadOnly") : selected.description || translate("groups.descriptionFallback")}</p></div>{canManage && !selected.importedFrom && <div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => setEditing((current) => !current)}><Pencil size={14} />{editing ? translate("groups.cancelEdit") : translate("groups.edit")}</button><button className="button button-danger" type="button" onClick={() => void deleteGroup(selected)}><Trash2 size={14} />{translate("groups.delete")}</button></div>}</div>
          {canManage && editing && <form className="community-group-form" onSubmit={saveGroup}><label>{translate("groups.name")}<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label><label>{translate("groups.description")}<textarea rows={2} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} /></label><button className="button button-primary" type="submit" disabled={saving}><Check size={15} />{translate("groups.save")}</button></form>}
          {canManage && !selected.importedFrom && <section className="group-public-signup"><div className="community-members-heading"><div><h3>{translate("groups.publicSignup")}</h3><p>{translate("groups.publicSignupHelp")}</p></div><label className="group-public-signup-toggle"><input type="checkbox" checked={Boolean(selected.publicSignupEnabled)} disabled={signupSaving} onChange={(event) => void setPublicSignupEnabled(event.target.checked)} /><span>{selected.publicSignupEnabled ? translate("groups.enabled") : translate("groups.off")}</span></label></div>{selected.publicSignupEnabled && selected.publicSignupToken && <div className="group-public-signup-link"><code>{window.location.origin}/join-group/{selected.publicSignupToken}</code><button className="button button-secondary" type="button" onClick={() => void copyGroupSignupLink(selected)}><Link2 size={14} />{translate("groups.copyLink")}</button></div>}</section>}
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
            {meetings.length > 0 && <label className="group-meeting-picker">{translate("groups.meeting")}<select value={activeMeetingId} onChange={(event) => setActiveMeetingId(event.target.value)}><option value="">{translate("groups.chooseMeeting")}</option>{meetings.map((meeting) => <option key={meeting.id} value={meeting.id}>{formatUserDate(meeting.date)} {meeting.title ? `· ${meeting.title}` : ""} · {meeting.presentCount}/{meeting.attendeeCount} present</option>)}</select></label>}
            {activeMeetingId && <><div className="group-attendance-heading"><strong>{translate("groups.presentCount").replace("{count}", String(attendance.length))}</strong>{canManage && <button className="button button-primary" type="button" onClick={() => void saveAttendance()} disabled={attendanceSaving || attendanceLoading}><Check size={14} />{attendanceSaving ? translate("settings.personal.saving") : translate("groups.saveAttendance")}</button>}</div>{attendanceLoading ? <p className="community-empty">{translate("groups.loading")}</p> : attendance.length ? <div className="group-attendance-list">{attendance.map((entry) => <label className="community-member-row" key={entry.contactId}><span className="community-member-avatar">{entry.firstName[0]}{entry.lastName[0]}</span><span><strong>{entry.firstName} {entry.lastName}</strong></span><select aria-label={translate("groups.attendanceFor").replace("{name}", `${entry.firstName} ${entry.lastName}`)} disabled={!canManage} value={entry.status} onChange={(event) => setAttendance((current) => current.map((person) => person.contactId === entry.contactId ? { ...person, status: event.target.value as AttendanceEntry["status"] } : person))}><option value="present">{translate("groups.present")}</option><option value="absent">{translate("groups.absent")}</option><option value="excused">{translate("groups.excused")}</option></select></label>)}</div> : <p className="community-empty">{translate("groups.noRoster")}</p>}</>}
            {!meetings.length && !canManage && <p className="community-empty">{translate("groups.noMeetings")}</p>}
          </section>}
        </> : canManage ? <form className="community-new-group" onSubmit={saveGroup}><span className="community-group-icon"><ContactRound size={20} /></span><h2>{translate("groups.createStart")}</h2><p>{translate("groups.createStartHelp")}</p><label>{translate("groups.name")}<input autoFocus required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder={translate("groups.groupNameExample")} /></label><label>{translate("groups.description")} <span className="optional-label">{translate("groups.optional")}</span><textarea rows={3} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={translate("groups.whoBelongs")} /></label><button className="button button-primary" type="submit" disabled={saving || !name.trim()}><Plus size={16} />{translate("groups.create")}</button></form> : <p className="community-empty">{translate("groups.selectHint")}</p>}
      </section>
    </section>
    <footer className="page-footer"><span>{translate("groups.footer")}</span><span>© 2026 Smart Church</span></footer>
  </>;
}
