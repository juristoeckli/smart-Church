import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Check, ChevronDown, Printer, RotateCcw, Search, UserPlus, Users } from "lucide-react";
import type { ModuleContext } from "../../module-registry";
import "./module.css";
import { GroupMeetingAttendance } from "./GroupMeetingAttendance";
import { checkInPrintFormats, checkInPrintItems, readCheckInPrintOptions, writeCheckInPrintDocument, type CheckInPrintMode, type CheckInPrintOptions } from "./printing";

type EventRow = { id: string; title: string; kind: string; eventDate: string; startTime: string; location: string; completedAt: string | null };
type GroupRow = { id: string; name: string; memberCount: number; parentGroupId: string | null };
type Attendee = { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; firstTimeVisitor: boolean; checkedInAt: string | null; groups: string[]; isVisitor?: boolean; authorizedPickups: Array<{ id: string; name: string }>; previousPickupIds?: string[]; pickupRelease?: { name: string; at: string } | null };
type RosterLayout = "full" | "groups" | "people";
type AttendanceFilter = "all" | "awaiting" | "present" | "released";
type IdentityCheck = "" | "photo_id" | "personally_known";

// An event-specific reference for finding a roster entry. It grants no access.
function deskCode(departmentId: string, eventId: string, personId: string) {
  let hash = 2166136261;
  for (const character of [departmentId, eventId, personId].join(":")) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

export function CheckInModule({ csrfToken, department, departmentId, realtime, state, onStateChange }: ModuleContext) {
  const [groupAttendanceOpen, setGroupAttendanceOpen] = useState(false);
  const canManageGroupAttendance = department.role === "site_admin" || (department.permissions ?? []).includes("groups_manage");
  const [events, setEvents] = useState<EventRow[]>([]); const [groups, setGroups] = useState<GroupRow[]>([]);
  const [eventId, setEventId] = useState(""); const [groupIds, setGroupIds] = useState<string[]>([]); const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [hierarchyAvailable, setHierarchyAvailable] = useState(false); const [includeChildGroups, setIncludeChildGroups] = useState(false);
  const [canManage, setCanManage] = useState(false); const [canAddVisitor, setCanAddVisitor] = useState(false); const [visitorDialogOpen, setVisitorDialogOpen] = useState(false); const [visitorBusy, setVisitorBusy] = useState(false); const [pickupEditor, setPickupEditor] = useState<Attendee | null>(null); const [pickupContactIds, setPickupContactIds] = useState<string[]>([]); const [guardianConfirmed, setGuardianConfirmed] = useState(false);
  const [codeQuery, setCodeQuery] = useState("");
  const [releaseAttendee, setReleaseAttendee] = useState<{ id: string; scope: string } | null>(null);
  const [releaseContactId, setReleaseContactId] = useState("");
  const [identityCheck, setIdentityCheck] = useState<IdentityCheck>("");
  const printOptions = readCheckInPrintOptions(state);
  function updatePrintOptions(changes: Partial<CheckInPrintOptions>) {
    onStateChange(JSON.stringify({ ...printOptions, ...changes }));
  }
  const [loadedScope, setLoadedScope] = useState("");
  const [stationScope, setStationScope] = useState<string | null>(null);
  const rosterScope = JSON.stringify([departmentId, eventId, groupIds, includeChildGroups]);
  const rosterReady = Boolean(eventId && groupIds.length && loadedScope === rosterScope);
  const [lastArrival, setLastArrival] = useState<{ contactId: string; scope: string; revision: string }>();
  useEffect(() => setLastArrival(undefined), [rosterScope]);
  const currentPrintScope = useRef({ key: rosterScope, canManage, stationScope });
  currentPrintScope.current = { key: rosterScope, canManage, stationScope };
  const [layout, setLayout] = useState<RosterLayout>("full");
  const [attendanceFilter, setAttendanceFilter] = useState<AttendanceFilter>("all");
  const [query, setQuery] = useState(""); const [sort, setSort] = useState<"name" | "group" | "present">("name"); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const reloadBase = useCallback(async () => {
    const response = await fetch("/api/modules/check-in/bootstrap", { credentials: "include", headers: { "x-department-id": departmentId } }); const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not load meetings."); setEvents(data.events); setGroups(data.groups); setHierarchyAvailable(Boolean(data.hierarchyAvailable)); setCanManage(Boolean(data.canManage)); setCanAddVisitor(Boolean(data.canAddVisitor)); if (!data.hierarchyAvailable) setIncludeChildGroups(false);
  }, [departmentId]);
  const rosterRequest = useRef(0);
  const reloadRoster = useCallback(async () => {
    const request = ++rosterRequest.current;
    if (!eventId || !groupIds.length) { setAttendees([]); return; }
    const params = new URLSearchParams({ groups: groupIds.join(","), ...(includeChildGroups ? { includeChildGroups: "true" } : {}) }); const response = await fetch(`/api/modules/check-in/events/${eventId}/roster?${params}`, { credentials: "include", headers: { "x-department-id": departmentId } }); const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not load the roster.");
    const roster = data.attendees as Attendee[];
    if (request === rosterRequest.current) { setAttendees(roster); setLoadedScope(rosterScope); }
    return roster;
  }, [eventId, groupIds, includeChildGroups, departmentId, rosterScope]);
  useEffect(() => { reloadBase().catch((e) => setError(e.message)); }, [reloadBase]);
  useEffect(() => { reloadRoster().catch((e) => setError(e.message)); }, [reloadRoster]);
  useEffect(() => {
    if (!realtime) return;
    const refresh = () => {
      reloadBase().catch((reason) => setError(reason.message));
      reloadRoster().catch((reason) => setError(reason.message));
    };
    const unsubscribe = realtime.subscribe("module:check-in:changed", refresh);
    const unsubscribeReconnect = realtime.subscribe("realtime:connected", refresh);
    return () => { unsubscribe(); unsubscribeReconnect(); };
  }, [realtime, reloadBase, reloadRoster]);
  useEffect(() => { setCodeQuery(""); setStationScope(null); setPickupEditor(null); setReleaseAttendee(null); }, [rosterScope]);
  const normalizedCode = canManage ? codeQuery.trim().toUpperCase() : "";
  const shown = useMemo(() => {
    if (!rosterReady) return [];
    const needle = query.trim().toLocaleLowerCase();
    const matching = attendees.filter((person) => {
      // A desk reference is used for pickup. Arrival filters and name search must not hide its match.
      if (normalizedCode) return deskCode(departmentId, eventId, person.id) === normalizedCode;
      const present = Boolean(person.checkedInAt && !person.pickupRelease);
      if (attendanceFilter === "awaiting" && (person.checkedInAt || person.pickupRelease)) return false;
      if (attendanceFilter === "present" && !present) return false;
      if (attendanceFilter === "released" && !person.pickupRelease) return false;
      return `${person.firstName} ${person.lastName} ${person.groups.join(" ")}`.toLocaleLowerCase().includes(needle);
    });
    return matching.sort((a, b) => {
      if (sort === "group") {
        const groupOrder = a.groups.join().localeCompare(b.groups.join());
        if (groupOrder) return groupOrder;
      } else if (sort === "present") {
        const presentOrder = Number(Boolean(b.checkedInAt && !b.pickupRelease)) - Number(Boolean(a.checkedInAt && !a.pickupRelease));
        if (presentOrder) return presentOrder;
      }
      return a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
    });
  }, [attendees, attendanceFilter, query, sort, rosterReady, normalizedCode, departmentId, eventId]);
  const mark = async (person: Attendee, present: boolean, undoRevision?: string) => {
    if (!rosterReady || !canManage) return null;
    setBusy(true); setError("");
    let saved = false;
    try {
      const response = await fetch(`/api/modules/check-in/events/${eventId}/attendees/${person.id}`, {
        method: "PUT", credentials: "include",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken, "x-department-id": departmentId },
        body: JSON.stringify({ present, firstTimeVisitor: person.firstTimeVisitor, groupIds, includeChildGroups, undoRevision }),
      });
      const data = await response.json() as { error?: string; undoRevision?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not update attendance.");
      saved = true;
      if (currentPrintScope.current.key === rosterScope) {
        if (present && data.undoRevision) setLastArrival({ contactId: person.id, scope: rosterScope, revision: data.undoRevision });
        else if (!present) setLastArrival((current) => current?.contactId === person.id ? undefined : current);
      }
      if (currentPrintScope.current.key !== rosterScope) return { person: undefined };
      return { person: (await reloadRoster())?.find((record) => record.id === person.id) };
    } catch (reason) {
      if (undoRevision && !saved) {
        setLastArrival((current) => current?.revision === undoRevision ? undefined : current);
        if (currentPrintScope.current.key === rosterScope) await reloadRoster().catch(() => {});
      }
      setError(saved ? "Attendance was saved. Refresh to update the roster." : reason instanceof Error ? reason.message : "Update failed.");
      return saved ? { person: undefined } : null;
    } finally { setBusy(false); }
  };
  const addVisitor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!eventId || !groupIds.length || !canAddVisitor) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const firstName = String(values.get("firstName") ?? "").trim();
    const lastName = String(values.get("lastName") ?? "").trim();
    const email = String(values.get("email") ?? "").trim();
    const phone = String(values.get("phone") ?? "").trim();
    setVisitorBusy(true); setError("");
    const headers = { "x-department-id": departmentId };
    try {
      const contactResponse = await fetch("/api/contacts", { credentials: "include", headers });
      const existing = await contactResponse.json() as Array<{ id: string; firstName: string; lastName: string; email?: string; phone?: string; status: "member" | "visitor" }> | { error?: string };
      if (!contactResponse.ok || !Array.isArray(existing)) throw new Error(!Array.isArray(existing) ? existing.error ?? "Could not check for existing people." : "Could not check for existing people.");
      const normalizedEmail = email.toLocaleLowerCase();
      const normalizedPhone = phone.toLocaleLowerCase();
      const duplicate = existing.find((person) => (normalizedEmail && person.email?.trim().toLocaleLowerCase() === normalizedEmail)
        || (person.firstName.trim().toLocaleLowerCase() === firstName.toLocaleLowerCase()
          && person.lastName.trim().toLocaleLowerCase() === lastName.toLocaleLowerCase()
          && ((normalizedPhone && person.phone?.trim().toLocaleLowerCase() === normalizedPhone) || (!normalizedPhone && !person.phone))));
      let contactId = duplicate?.id;
      if (duplicate && duplicate.status !== "visitor") throw new Error("A matching person already exists in this location. Select the existing member from their group roster instead of adding a duplicate.");
      if (!contactId) {
        const createdResponse = await fetch("/api/contacts", { method: "POST", credentials: "include", headers: { ...headers, "content-type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify({ firstName, lastName, ...(email ? { email } : {}), ...(phone ? { phone } : {}), status: "visitor" }) });
        const created = await createdResponse.json() as { id?: string; error?: string };
        if (!createdResponse.ok || !created.id) throw new Error(created.error ?? "Could not add this visitor.");
        contactId = created.id;
      }
      if (!contactId) throw new Error("Could not find or add this visitor.");
      const checkInResponse = await fetch(`/api/modules/check-in/events/${eventId}/attendees/${contactId}`, { method: "PUT", credentials: "include", headers: { ...headers, "content-type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify({ present: true, firstTimeVisitor: true, groupIds, includeChildGroups }) });
      const checkedIn = await checkInResponse.json() as { error?: string; undoRevision?: string };
      if (!checkInResponse.ok) throw new Error(checkedIn.error ?? "The visitor was saved but could not be checked in. Try again from this roster.");
      if (checkedIn.undoRevision && currentPrintScope.current.key === rosterScope) {
        setLastArrival({ contactId, scope: rosterScope, revision: checkedIn.undoRevision });
      }
      setVisitorDialogOpen(false); form.reset(); await reloadRoster();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add this visitor."); }
    finally { setVisitorBusy(false); }
  };
  const openPickupEditor = (person: Attendee) => { setPickupEditor(person); setPickupContactIds(person.authorizedPickups.map((item) => item.id)); setGuardianConfirmed(false); };
  const savePickups = async () => {
    if (!pickupEditor || !rosterReady || !canManage) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/modules/check-in/events/${eventId}/attendees/${pickupEditor.id}/pickups`, { method: "PUT", credentials: "include", headers: { "content-type": "application/json", "x-csrf-token": csrfToken, "x-department-id": departmentId }, body: JSON.stringify({ groupIds, includeChildGroups, authorizedContactIds: pickupContactIds, guardianConfirmed }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Could not save pickup contacts.");
      setPickupEditor(null); await reloadRoster();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save pickup contacts."); }
    finally { setBusy(false); }
  };
  const releasePerson = rosterReady && releaseAttendee?.scope === rosterScope
    ? attendees.find((person) => person.id === releaseAttendee.id && !person.pickupRelease)
    : undefined;
  function openRelease(person: Attendee) {
    setReleaseAttendee({ id: person.id, scope: rosterScope });
    setError("");
    setReleaseContactId("");
    setIdentityCheck("");
  }
  async function confirmRelease(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !releasePerson?.checkedInAt || !identityCheck || !releasePerson.authorizedPickups.some((item) => item.id === releaseContactId)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/modules/check-in/events/${eventId}/attendees/${releasePerson.id}/release`, {
        method: "PUT", credentials: "include",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken, "x-department-id": departmentId },
        body: JSON.stringify({ authorizedContactId: releaseContactId, identityCheck }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not record pickup.");
      setReleaseAttendee(null);
      await reloadRoster();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not record pickup.");
    } finally {
      setBusy(false);
    }
  }
  const selected = events.find((e) => e.id === eventId);
  const selectedGroupNames = groups.filter((group) => groupIds.includes(group.id)).map((group) => group.name);
  const activeLayout = !selected ? "full" : layout === "people" && !groupIds.length ? "groups" : layout; const presentCount = attendees.filter((p) => p.checkedInAt && !p.pickupRelease).length;
  const complete = Boolean(selected?.completedAt);
  const toggleComplete = async () => {
    if (!eventId) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/modules/check-in/events/${eventId}/session`, { method: "PUT", credentials: "include", headers: { "content-type": "application/json", "x-csrf-token": csrfToken, "x-department-id": departmentId }, body: JSON.stringify({ complete: !complete }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Could not update the meeting check-in state."); await reloadBase();
    } catch (e) { setError(e instanceof Error ? e.message : "Update failed."); }
    finally { setBusy(false); }
  };
  const mayPrintPickup = (person: Attendee) => canManage && !person.isVisitor && !person.pickupRelease
    && Boolean(person.checkedInAt) && person.authorizedPickups.length > 0;
  const presentForPickup = shown.filter(mayPrintPickup);
  const releaseControl = (person: Attendee) => person.pickupRelease
    ? <small>Released to {person.pickupRelease.name} · {new Date(person.pickupRelease.at).toLocaleTimeString()}</small>
    : canManage && person.checkedInAt && person.authorizedPickups.length > 0 && <button type="button" className="checkin-pickup-edit" disabled={busy} onClick={() => openRelease(person)}>Verify pickup</button>;
  const releaseDialog = releasePerson && <div className="checkin-dialog-backdrop" role="presentation">
    <form className="checkin-pickup-dialog" role="dialog" aria-modal="true" aria-labelledby="checkin-release-title" onSubmit={(event) => void confirmRelease(event)}>
      <header><div><h2 id="checkin-release-title">Verify pickup and release</h2><p>{releasePerson.firstName} {releasePerson.lastName} · {selected?.title}</p></div>
        <button type="button" onClick={() => setReleaseAttendee(null)} disabled={busy} aria-label="Close">×</button>
      </header>
      <p>Match the person at the desk to a contact authorized for this meeting before releasing the child.</p>
      {error && <p className="checkin-error" role="alert">{error}</p>}
      <label>Authorized contact<select autoFocus required value={releaseContactId} onChange={(event) => setReleaseContactId(event.target.value)}>
        <option value="">Choose a contact…</option>
        {releasePerson.authorizedPickups.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
      </select></label>
      <label>Identity check<select required value={identityCheck} onChange={(event) => setIdentityCheck(event.target.value as IdentityCheck)}>
        <option value="">Choose how you verified identity…</option>
        <option value="photo_id">I checked their photo ID</option>
        <option value="personally_known">I personally know this contact</option>
      </select></label>
      <div className="checkin-pickup-actions"><button type="button" onClick={() => setReleaseAttendee(null)} disabled={busy}>Cancel</button><button type="submit" disabled={busy || !releaseContactId || !identityCheck}>Record release</button></div>
    </form>
  </div>;
  function openPrintWindow() {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setError("Allow pop-ups to open the Check-in print view.");
      return null;
    }
    printWindow.opener = null;
    printWindow.document.title = "Check-in print";
    printWindow.document.body.textContent = "Preparing Check-in print preview…";
    return printWindow;
  }

  function finishPrint(printWindow: Window, people: Attendee[], mode: CheckInPrintMode) {
    if (printWindow.closed) return;
    try {
      const title = mode === "labels" ? "Check-in name labels" : "Check-in pickup pairs";
      const items = people.flatMap((person) => checkInPrintItems(person, selected?.title ?? "", deskCode(departmentId, eventId, person.id), mode, printOptions));
      writeCheckInPrintDocument(printWindow.document, title, items, printOptions);
      printWindow.focus();
      printWindow.print();
    } catch {
      printWindow.close();
      setError("The print preview could not open. Try printing again.");
    }
  }

  function printRoster(mode: CheckInPrintMode, person?: Attendee) {
    if (!rosterReady) return;
    const people = person ? (mode === "pickup" && !mayPrintPickup(person) ? [] : [person]) : mode === "labels" ? shown : presentForPickup;
    if (!people.length) return;
    const printWindow = openPrintWindow();
    if (printWindow) finishPrint(printWindow, people, mode);
  }

  async function checkInAndPrint(person: Attendee) {
    if (!canManage || !rosterReady || busy || complete) return;
    const printWindow = openPrintWindow();
    if (!printWindow) return;
    const result = await mark(person, true);
    if (!result || currentPrintScope.current.key !== rosterScope || currentPrintScope.current.stationScope !== rosterScope || !currentPrintScope.current.canManage) {
      printWindow.close();
      return;
    }
    // If the roster could not refresh, the confirmed attendance still permits
    // a name badge. Pickup slips require a fresh, unreleased authorization.
    const record = result.person;
    if (record && (!record.checkedInAt || record.pickupRelease)) {
      printWindow.close();
      setError("Attendance changed before printing. Check the roster before trying again.");
      return;
    }
    const output = printOptions.stationOutput === "pickup" && record && mayPrintPickup(record) ? "pickup" : "labels";
    finishPrint(printWindow, [record ?? person], output);
  }

  const printOptionsPanel = <details className="checkin-print-options">
    <summary>Print settings</summary>
    <div className="checkin-print-options-fields">
      <label>Paper or label size<select value={printOptions.format} onChange={(event) => updatePrintOptions({ format: event.target.value as CheckInPrintOptions["format"] })}>
        {checkInPrintFormats.map(([format, option]) => <option key={format} value={format}>{option.label}</option>)}
      </select></label>
      <label>Surname on name labels<select value={printOptions.surname} onChange={(event) => updatePrintOptions({ surname: event.target.value === "initial" ? "initial" : "full" })}>
        <option value="full">Full surname</option><option value="initial">Initial only</option>
      </select></label>
      {canManage && <label>Check in &amp; print output<select value={printOptions.stationOutput} onChange={(event) => updatePrintOptions({ stationOutput: event.target.value === "pickup" ? "pickup" : "labels" })}>
        <option value="labels">Name label</option><option value="pickup">Pickup pair when authorized, otherwise name label</option>
      </select></label>}
      <label><input type="checkbox" checked={printOptions.showGroup} onChange={(event) => updatePrintOptions({ showGroup: event.target.checked })} /> Print group on labels</label>
      <label><input type="checkbox" checked={printOptions.showMeeting} onChange={(event) => updatePrintOptions({ showMeeting: event.target.checked })} /> Print meeting name</label>
    </div>
    <p>Choose the matching paper or roll in your browser’s print dialog.</p>
  </details>;

  if (canManageGroupAttendance && groupAttendanceOpen) {
    return <GroupMeetingAttendance key={departmentId} departmentId={departmentId} csrfToken={csrfToken} onBack={() => setGroupAttendanceOpen(false)} />;
  }

  const recentArrival = canManage && rosterReady && !complete && lastArrival?.scope === rosterScope
    ? attendees.find((person) => person.id === lastArrival.contactId && person.checkedInAt && !person.pickupRelease) : undefined;
  const undoLastArrival = lastArrival && recentArrival ? <button type="button" className="checkin-reset"
    disabled={busy || visitorBusy} onClick={() => void mark(recentArrival, false, lastArrival.revision)}>
    <RotateCcw size={15} /> Undo last check-in · {recentArrival.firstName} {recentArrival.lastName}
  </button> : null;

  if (canManage && rosterReady && stationScope === rosterScope) {
    return <main className="checkin-module">
      <header className="checkin-heading">
        <div><h1>Check-in station</h1><p>{selected?.title} · {presentCount} of {attendees.length} present</p></div>
        <button type="button" className="checkin-print" onClick={() => { setStationScope(null); setQuery(""); setCodeQuery(""); }}>Exit station</button>
      </header>
      {error && <div className="checkin-error" role="alert">{error}</div>}
      {complete && <p>Meeting check-in completed.</p>}
      {printOptionsPanel}
      {undoLastArrival}
      <label className="checkin-search"><Search size={17}/> Find attendee
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <label className="checkin-search">Desk code<input value={codeQuery} onChange={(event) => setCodeQuery(event.target.value)} maxLength={8} autoComplete="off" spellCheck={false} /></label>
      {(query.trim() || normalizedCode) && <div className="checkin-roster">
        {shown.map((person) => <article className="checkin-person" key={person.id}>
          <div className="checkin-person-info"><strong>{person.firstName} {person.lastName}</strong><small>{person.groups.join(" · ")}</small></div>
          {releaseControl(person)}
          {person.checkedInAt && !person.pickupRelease && <div className="checkin-station-actions">
            <span>Present</span>
            <button type="button" className="checkin-pickup-edit" disabled={busy} onClick={() => printRoster("labels", person)}><Printer size={15}/> Print label</button>
            {mayPrintPickup(person) && <button type="button" className="checkin-pickup-edit" disabled={busy} onClick={() => printRoster("pickup", person)}>Print pickup pair</button>}
          </div>}
          {!person.checkedInAt && !person.pickupRelease && <div className="checkin-station-actions">
            <button type="button" className="checkin-mark" disabled={busy || complete} onClick={() => void mark(person, true)}><Check size={16}/> Check in</button>
            <button type="button" className="checkin-pickup-edit" disabled={busy || complete} onClick={() => void checkInAndPrint(person)}><Printer size={15}/> Check in &amp; print</button>
          </div>}
        </article>)}
        {!shown.length && <p className="checkin-empty">No attendees match.</p>}
      </div>}
      {releaseDialog}
    </main>;
  }

  return <main className="checkin-module">
    <header className="checkin-heading"><div><p className="checkin-eyebrow">WELCOME DESK</p><h1>Check-in</h1><p>Choose a service event and groups to build a shared attendee roster.</p></div><div className="checkin-print-actions">{canManageGroupAttendance && <button type="button" className="checkin-print" onClick={() => setGroupAttendanceOpen(true)}>Group meeting attendance</button>}{canManage && <button type="button" className="checkin-print" disabled={!rosterReady || busy || visitorBusy} onClick={() => { setQuery(""); setCodeQuery(""); setAttendanceFilter("all"); setStationScope(rosterScope); }}>Open check-in station</button>}<button type="button" className="checkin-print" onClick={() => printRoster("labels")} disabled={!rosterReady || !shown.length}><Printer size={17}/> Print name labels</button>{canManage && <button type="button" className="checkin-print" onClick={() => printRoster("pickup")} disabled={!rosterReady || !presentForPickup.length}><Printer size={17}/> Print pickup pairs</button>}</div></header>
    {error && <div className="checkin-error" role="alert">{error}</div>}
    {printOptionsPanel}
    <div className="checkin-view-controls">
      <label>Roster layout<select value={activeLayout} onChange={(event) => setLayout(event.target.value as RosterLayout)}>
        <option value="full">Meetings, groups and people</option>
        <option value="groups" disabled={!eventId}>Groups and people</option>
        <option value="people" disabled={!eventId || !groupIds.length}>People only</option>
      </select></label>
      {activeLayout !== "full" && selected && <div className="checkin-scope-summary">
        <strong>{selected.title}</strong>
        <span>{selected.eventDate} · {selected.startTime.slice(0, 5)}{selected.location ? " · " + selected.location : ""}</span>
        {activeLayout === "people" && <span>{selectedGroupNames.join(" · ")}{includeChildGroups ? " · includes child groups" : ""}</span>}
      </div>}
    </div>
    {activeLayout !== "people" && <section className="checkin-setup">
      {activeLayout === "full" && <label>Meeting<select value={eventId} onChange={(e) => setEventId(e.target.value)}>
        <option value="">Select a meeting…</option>{events.map((event) => <option value={event.id} key={event.id}>
          {event.eventDate} · {event.startTime.slice(0, 5)} · {event.title}{event.completedAt ? " · completed" : ""}
        </option>)}
      </select></label>}
      <fieldset><legend>Groups and age subgroups</legend><div className="checkin-groups">{groups.map((group) =>
        <label key={group.id} className={groupIds.includes(group.id) ? "selected" : ""}>
          <input type="checkbox" checked={groupIds.includes(group.id)} onChange={() => setGroupIds((previous) => previous.includes(group.id) ? previous.filter((id) => id !== group.id) : [...previous, group.id])} />
          <span>{group.parentGroupId ? "↳ " : ""}{group.name}</span><small>{group.memberCount}</small>
        </label>)}</div>
        {hierarchyAvailable && <label className="checkin-descendant-option"><input type="checkbox" checked={includeChildGroups} onChange={(event) => setIncludeChildGroups(event.target.checked)} /> Include members of child groups</label>}
      </fieldset>
      {activeLayout === "full" && selected && <p className="checkin-event-meta">{selected.location} <span>·</span> {selected.kind}</p>}
    </section>}
    <section className="checkin-toolbar">
      <strong><Users size={17}/> {rosterReady ? `${presentCount} of ${attendees.length} present` : "Attendees"}</strong>
      {undoLastArrival}
      <label className="checkin-search"><Search size={17}/><input aria-label="Search people or groups" placeholder="Search people or groups" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label className="checkin-sort">Sort <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
        <option value="name">Name</option><option value="group">Group</option><option value="present">Present first</option>
      </select><ChevronDown size={14}/></label>
      <label className="checkin-sort">Attendance <select value={attendanceFilter} onChange={(event) => setAttendanceFilter(event.target.value as AttendanceFilter)}>
        <option value="all">All attendees</option><option value="awaiting">Not arrived</option><option value="present">Present now</option><option value="released">Released</option>
      </select><ChevronDown size={14}/></label>
      {canManage && rosterReady && <label className="checkin-search"><span>Desk code</span><input aria-label="Find attendee by desk code" placeholder="8-character code" value={codeQuery} onChange={(event) => setCodeQuery(event.target.value)} maxLength={8} autoComplete="off" spellCheck={false} /></label>}
      {canAddVisitor && eventId && groupIds.length > 0 && <button className="checkin-pickup-edit" type="button" onClick={() => setVisitorDialogOpen(true)} disabled={busy || visitorBusy}><UserPlus size={15}/> Add visitor</button>}
    </section>
    {normalizedCode && <p className="checkin-lookup-note">Searching by desk code across this meeting roster.</p>}
    {!eventId || !groupIds.length ? <div className="checkin-empty">Select a meeting and at least one group to see its roster.</div> : !rosterReady ? <div className="checkin-empty" role="status">Loading the roster…</div> : <div className="checkin-roster">{shown.map((person) => <article className={`checkin-person ${person.checkedInAt ? "is-present" : ""}`} key={person.id}><div className="checkin-avatar">{person.firstName.slice(0,1)}{person.lastName.slice(0,1)}</div><div className="checkin-person-info"><strong>{person.firstName} {person.lastName}</strong><small>{person.groups.join(" · ")}</small>{person.phone && <small>{person.phone}</small>}{person.authorizedPickups.length > 0 && <small>Authorized pickup: {person.authorizedPickups.map((item) => item.name).join(", ")}</small>}</div>{releaseControl(person)}{canManage && !person.isVisitor && !person.pickupRelease && <button className="checkin-pickup-edit" type="button" onClick={() => openPickupEditor(person)}>Pickup contacts</button>}<button className={person.checkedInAt ? "checkin-reset" : "checkin-mark"} disabled={!canManage || busy || complete || Boolean(person.pickupRelease)} onClick={() => mark(person, !person.checkedInAt)}>{person.checkedInAt ? <><RotateCcw size={15}/> Undo</> : <><Check size={16}/> Present</>}</button></article>)}{!shown.length && <div className="checkin-empty">No attendees match this view.</div>}</div>}
    <footer className="checkin-footer"><span>{complete ? `Meeting check-in completed${selected?.completedAt ? ` · ${new Date(selected.completedAt).toLocaleString()}` : ""}` : "Attendance is saved as people arrive."}</span><button onClick={() => void toggleComplete()} disabled={!eventId || busy}>{complete ? "Reopen check-in" : "Complete check-in"}</button></footer>
    {pickupEditor && <div className="checkin-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPickupEditor(null)}><section className="checkin-pickup-dialog" role="dialog" aria-modal="true" aria-labelledby="checkin-pickup-title"><header><div><h2 id="checkin-pickup-title">Authorized pickup contacts</h2><p>{pickupEditor.firstName} {pickupEditor.lastName} · {selected?.title}</p></div><button type="button" onClick={() => setPickupEditor(null)} aria-label="Close">×</button></header><p>Choose roster contacts a parent or guardian has authorized to collect this child at this meeting. The app records which staff member confirmed the list and when.</p><div className="checkin-pickup-options">{attendees.filter((person) => person.id !== pickupEditor.id && !person.isVisitor).map((person) => <label key={person.id}><input type="checkbox" checked={pickupContactIds.includes(person.id)} onChange={() => setPickupContactIds((current) => current.includes(person.id) ? current.filter((id) => id !== person.id) : [...current, person.id])} /><span>{person.firstName} {person.lastName}{pickupEditor.previousPickupIds?.includes(person.id) ? " · previous pickup contact" : ""}</span></label>)}</div><label className="checkin-guardian-confirm"><input type="checkbox" checked={guardianConfirmed} onChange={(event) => setGuardianConfirmed(event.target.checked)} /><span>I confirmed this pickup list with the parent or guardian.</span></label><div className="checkin-pickup-actions"><button type="button" onClick={() => setPickupEditor(null)}>Cancel</button><button type="button" disabled={busy || !guardianConfirmed} onClick={() => void savePickups()}>Save pickup contacts</button></div></section></div>}
    {visitorDialogOpen && <div className="checkin-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setVisitorDialogOpen(false)}><form className="checkin-pickup-dialog" role="dialog" aria-modal="true" aria-labelledby="checkin-visitor-title" onSubmit={(event) => void addVisitor(event)}><header><div><h2 id="checkin-visitor-title">Add a walk-in visitor</h2><p>{selected?.title} · {selected?.eventDate}</p></div><button type="button" onClick={() => setVisitorDialogOpen(false)} aria-label="Close">×</button></header><p>Creates a visitor contact in this location and checks them in as a first-time visitor. Possible duplicate people are blocked.</p><label>First name<input name="firstName" required maxLength={80} autoFocus /></label><label>Last name<input name="lastName" required maxLength={80} /></label><label>Email <span className="optional-label">Optional</span><input name="email" type="email" maxLength={254} /></label><label>Phone <span className="optional-label">Optional</span><input name="phone" type="tel" maxLength={40} /></label><div className="checkin-pickup-actions"><button type="button" onClick={() => setVisitorDialogOpen(false)}>Cancel</button><button type="submit" disabled={visitorBusy || busy}><UserPlus size={15}/> {visitorBusy ? "Adding…" : "Add and check in"}</button></div></form></div>}
    {releaseDialog}
  </main>;
}
