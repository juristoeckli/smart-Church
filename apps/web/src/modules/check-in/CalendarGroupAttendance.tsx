import { useCallback, useEffect, useState } from "react";
import { GroupMeetingCompletion } from "../../GroupMeetingCompletion";
import { setGroupAttendanceCompletion, type CompletionFeedbackDraft, type GroupAttendanceStatus } from "../../group-attendance";
import type { ModuleRealtime } from "../../module-registry";

type Appointment = { appointmentId: string; originalOccurrenceStartAt: string; occurrenceStartAt: string; viewStartsAt?: string; title: string; calendarName: string; calendarScope: string; groupId?: string };
type Group = { id: string; name: string; status?: string; importedFrom?: string };
type Attendee = { groupId: string; contactId: string; firstName: string; lastName: string; role: string | null; status: GroupAttendanceStatus };
type Roster = { groups: Group[]; meetings: { id: string; groupId: string; completedAt: string | null }[]; attendees: Attendee[] };

function dateInLocation(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)?.value).join("-");
}

const occurrenceValue = (appointment: Appointment) => appointment.appointmentId + ":" + appointment.originalOccurrenceStartAt;

export function CalendarGroupAttendance({ departmentId, csrfToken, timeZone, parentByGroup, realtime, onBack }: {
  departmentId: string; csrfToken: string; timeZone: string; parentByGroup: ReadonlyMap<string, string>; realtime?: ModuleRealtime; onBack: () => void;
}) {
  const [date, setDate] = useState(() => dateInLocation(timeZone));
  const [groups, setGroups] = useState<Group[]>([]);
  const [appointments, setAppointments] = useState<{ date: string; rows: Appointment[] }>();
  const [selected, setSelected] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [includeChildren, setIncludeChildren] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; revision: number; roster: Roster }>();
  const [search, setSearch] = useState("");
  const [hidePresent, setHidePresent] = useState(false);
  const [rosterView, setRosterView] = useState<"groups" | "people">("groups");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const request = useCallback(async <T,>(path: string, signal?: AbortSignal, body?: object): Promise<T> => {
    const response = await fetch(path, {
      cache: "no-store", signal, ...(body ? { method: "PUT", body: JSON.stringify(body) } : {}),
      headers: { "x-department-id": departmentId, ...(body ? { "x-csrf-token": csrfToken, "content-type": "application/json" } : {}) },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not load calendar check-in.");
    return data as T;
  }, [departmentId, csrfToken]);

  useEffect(() => {
    const controller = new AbortController();
    void request<Group[]>("/api/groups", controller.signal).then(rows => {
      if (!controller.signal.aborted) setGroups(rows.filter(group => group.status === "active" && !group.importedFrom));
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [request]);

  useEffect(() => {
    if (!date) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ from: date + "T00:00:00", to: date + "T23:59:59", displayTimeZone: "location" });
    void request<Appointment[]>("/api/modules/church-calendar/appointments?" + query, controller.signal).then(rows => {
      if (!controller.signal.aborted) setAppointments({ date, rows: rows.filter(row => row.calendarScope !== "personal") });
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [date, request]);

  const choices = appointments?.date === date ? appointments.rows : [];
  const appointment = choices.find(item => occurrenceValue(item) === selected);
  const path = appointment ? "/api/modules/church-calendar/appointments/" + appointment.appointmentId + "/check-in/" + encodeURIComponent(appointment.originalOccurrenceStartAt) : "";
  const selectedGroups = new Set(groupIds);
  if (includeChildren) {
    for (const group of groups) {
      const visited = new Set([group.id]);
      let parent = parentByGroup.get(group.id);
      while (parent && !visited.has(parent)) {
        if (selectedGroups.has(parent)) {
          selectedGroups.add(group.id);
          break;
        }
        visited.add(parent);
        parent = parentByGroup.get(parent);
      }
    }
  }
  const tooManyGroups = selectedGroups.size > 25;
  const groupKey = tooManyGroups ? "" : [...selectedGroups].sort().join(",");
  const rosterKey = JSON.stringify([path, groupKey]);
  const roster = loaded?.key === rosterKey ? loaded.roster : undefined;
  const refreshing = loaded?.revision !== revision;
  const refresh = () => setRevision(value => value + 1);
  useEffect(() => {
    if (!path || !groupKey) return;
    const controller = new AbortController();
    void request<Roster>(path + "?" + new URLSearchParams({ groups: groupKey }), controller.signal).then(data => {
      if (!controller.signal.aborted) setLoaded({ key: rosterKey, revision, roster: data });
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [path, groupKey, rosterKey, request, revision]);

  useEffect(() => {
    if (!realtime || !groupKey || !path) return;
    return realtime.subscribe("core:groups:changed", event => {
      if (event.departmentId !== departmentId || !event.payload || typeof event.payload !== "object" || !("groupId" in event.payload)) return;
      if (groupKey.split(",").includes(String(event.payload.groupId))) setRevision(value => value + 1);
    });
  }, [departmentId, realtime, groupKey, path]);

  async function mark(row: Attendee) {
    if (!path || busy || refreshing) return;
    const present = row.status !== "present";
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(path + "/groups/" + row.groupId + "/attendees/" + row.contactId, undefined, { present, expectedStatus: row.status });
      setNotice(present ? "Attendance recorded." : "Attendance reset.");
      refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not record attendance.");
      refresh();
    } finally { setBusy(false); }
  }

  async function finishMeeting(meeting: Roster["meetings"][number], feedback?: CompletionFeedbackDraft) {
    setBusy(true);
    setError("");
    try {
      await setGroupAttendanceCompletion(meeting.id, departmentId, csrfToken, meeting.completedAt, feedback);
      refresh();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not change meeting completion.");
      refresh();
      return false;
    } finally { setBusy(false); }
  }

  const term = search.trim().toLocaleLowerCase();
  const visibleAttendees = roster?.attendees.filter(row => (!hidePresent || row.status !== "present")
    && (!term || (row.firstName + " " + row.lastName).toLocaleLowerCase().includes(term))) ?? [];
  const meetingsByGroup = new Map(roster?.meetings.map(meeting => [meeting.groupId, meeting]));
  const groupNames = new Map(roster?.groups.map(group => [group.id, group.name]));
  const attendeesByPerson = new Map<string, Attendee[]>();
  for (const row of visibleAttendees) {
    const memberships = attendeesByPerson.get(row.contactId) ?? [];
    memberships.push(row);
    attendeesByPerson.set(row.contactId, memberships);
  }
  function attendanceControl(row: Attendee, groupName: string) {
    return <>
      <span>{row.status === "present" ? "Present" : row.status === "excused" ? "Excused" : "Absent"}</span>
      <button type="button" className="checkin-print" disabled={busy || refreshing || Boolean(meetingsByGroup.get(row.groupId)?.completedAt)}
        aria-label={(row.status === "present" ? "Reset " : "Mark present: ") + row.firstName + " " + row.lastName + " · " + groupName}
        onClick={() => void mark(row)}>{row.status === "present" ? "Reset" : "Mark present"}</button>
    </>;
  }
  return <main className="checkin-module">
    <header className="checkin-heading"><div><h1>Calendar appointment check-in</h1></div>
      <button className="checkin-print" type="button" disabled={busy} onClick={onBack}>Back to service check-in</button>
    </header>
    <section className="checkin-setup">
      <label>Date<input type="date" value={date} disabled={busy} onChange={event => {
        setDate(event.target.value); setSelected(""); setError(""); setNotice("");
      }} /></label>
      <label>Calendar appointment<select value={selected} disabled={busy || appointments?.date !== date} onChange={event => {
        const item = choices.find(choice => occurrenceValue(choice) === event.target.value);
        setSelected(event.target.value); setError(""); setNotice("");
        if (item?.groupId && groups.some(group => group.id === item.groupId)) setGroupIds([item.groupId]);
      }}>
        <option value="">Select a calendar appointment</option>
        {choices.map(item => <option key={occurrenceValue(item)} value={occurrenceValue(item)}>
          {(item.viewStartsAt ?? item.occurrenceStartAt).slice(11, 16)} · {item.title} · {item.calendarName}
        </option>)}
      </select></label>
      <fieldset disabled={busy}>
        <legend>Groups for this roster</legend>
        {groups.map(group => <label key={group.id}><input type="checkbox" checked={groupIds.includes(group.id)}
          disabled={groupIds.length >= 25 && !groupIds.includes(group.id)}
          onChange={event => { setError(""); setNotice(""); setGroupIds(ids => (event.target.checked ? [...ids, group.id].sort() : ids.filter(id => id !== group.id))); }} /> {group.name}</label>)}
        {parentByGroup.size > 0 && <label><input type="checkbox" checked={includeChildren}
          onChange={event => setIncludeChildren(event.target.checked)} /> Include subgroups</label>}
      </fieldset>
    </section>
    {tooManyGroups && <p role="alert">Select up to 25 groups, including subgroups.</p>}
    {error && <p className="checkin-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {error && path && groupKey && !roster && <button type="button" className="checkin-print" onClick={() => { setError(""); refresh(); }}>Retry loading attendance</button>}
    {appointments?.date === date && choices.length === 0 && <p>No community or group appointments are scheduled for this date.</p>}
    {path && groupKey && !roster && !error && <p role="status">Loading group attendance…</p>}
    {roster && <>
      <div className="checkin-toolbar">
        <label>Display roster<select value={rosterView} onChange={event => setRosterView(event.target.value === "people" ? "people" : "groups")}>
          <option value="groups">By group</option><option value="people">By person</option>
        </select></label>
        <label>Find attendee<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <label><input type="checkbox" checked={hidePresent} onChange={event => setHidePresent(event.target.checked)} /> Hide present attendees</label>
        <button type="button" className="checkin-print" disabled={busy} onClick={refresh}>Refresh attendance</button>
      </div>
      {roster.groups.map(group => {
        const meeting = meetingsByGroup.get(group.id);
        const rows = roster.attendees.filter(row => row.groupId === group.id);
        const visible = visibleAttendees.filter(row => row.groupId === group.id);
        return <section key={group.id} aria-label={group.name} className="checkin-roster">
          <div className="checkin-toolbar">
            <h2>{group.name}</h2>
            <strong>{rows.filter(row => row.status === "present").length} present</strong>
            {meeting?.completedAt && <strong>Attendance completed.</strong>}
            {meeting && <GroupMeetingCompletion key={meeting.id} meetingId={meeting.id} departmentId={departmentId}
              completedAt={meeting.completedAt} disabled={busy || refreshing} buttonClass="checkin-print"
              onComplete={feedback => finishMeeting(meeting, feedback)} />}
          </div>
          {rosterView === "groups" && <>
            {visible.map(row => <article className={"checkin-person" + (row.status === "present" ? " is-present" : "")} key={row.contactId}>
              <div className="checkin-person-info"><strong>{row.firstName} {row.lastName}</strong>{row.role && <span>{row.role}</span>}</div>
              {attendanceControl(row, group.name)}
            </article>)}
            {!visible.length && <p>No attendees match this view.</p>}
          </>}
        </section>;
      })}
      {rosterView === "people" && <section className="checkin-roster" aria-label="Combined attendee roster">
        {Array.from(attendeesByPerson, ([contactId, memberships]) => <section key={contactId}>
          <h3>{memberships[0].firstName} {memberships[0].lastName}</h3>
          {memberships.map(row => {
            const groupName = groupNames.get(row.groupId) ?? "";
            return <article key={row.groupId} className={"checkin-person" + (row.status === "present" ? " is-present" : "")}>
              <div className="checkin-person-info"><strong>{groupName}</strong>{row.role && <span>{row.role}</span>}</div>
              {attendanceControl(row, groupName)}
            </article>;
          })}
        </section>)}
        {!attendeesByPerson.size && <p>No attendees match this view.</p>}
      </section>}
    </>}
  </main>;
}
