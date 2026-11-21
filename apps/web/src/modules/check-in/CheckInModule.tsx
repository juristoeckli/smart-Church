import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, ChevronDown, Printer, RotateCcw, Search, UserPlus, Users } from "lucide-react";
import type { ModuleContext } from "../../module-registry";
import "./module.css";

type EventRow = { id: string; title: string; kind: string; eventDate: string; startTime: string; location: string; completedAt: string | null };
type GroupRow = { id: string; name: string; memberCount: number; parentGroupId: string | null };
type Attendee = { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; firstTimeVisitor: boolean; checkedInAt: string | null; groups: string[]; isVisitor?: boolean; authorizedPickups: Array<{ id: string; name: string }> };

export function CheckInModule({ csrfToken, departmentId }: ModuleContext) {
  const [events, setEvents] = useState<EventRow[]>([]); const [groups, setGroups] = useState<GroupRow[]>([]);
  const [eventId, setEventId] = useState(""); const [groupIds, setGroupIds] = useState<string[]>([]); const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [hierarchyAvailable, setHierarchyAvailable] = useState(false); const [includeChildGroups, setIncludeChildGroups] = useState(false);
  const [canManage, setCanManage] = useState(false); const [canAddVisitor, setCanAddVisitor] = useState(false); const [visitorDialogOpen, setVisitorDialogOpen] = useState(false); const [visitorBusy, setVisitorBusy] = useState(false); const [pickupEditor, setPickupEditor] = useState<Attendee | null>(null); const [pickupContactIds, setPickupContactIds] = useState<string[]>([]); const [guardianConfirmed, setGuardianConfirmed] = useState(false);
  const [query, setQuery] = useState(""); const [presentOnly, setPresentOnly] = useState(false); const [sort, setSort] = useState<"name" | "group" | "present">("name"); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const reloadBase = useCallback(async () => {
    const response = await fetch("/api/modules/check-in/bootstrap", { credentials: "include" }); const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not load meetings."); setEvents(data.events); setGroups(data.groups); setHierarchyAvailable(Boolean(data.hierarchyAvailable)); setCanManage(Boolean(data.canManage)); setCanAddVisitor(Boolean(data.canAddVisitor)); if (!data.hierarchyAvailable) setIncludeChildGroups(false);
  }, [departmentId]);
  const reloadRoster = useCallback(async () => {
    if (!eventId || !groupIds.length) { setAttendees([]); return; }
    const params = new URLSearchParams({ groups: groupIds.join(","), ...(includeChildGroups ? { includeChildGroups: "true" } : {}) }); const response = await fetch(`/api/modules/check-in/events/${eventId}/roster?${params}`, { credentials: "include" }); const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not load the roster."); setAttendees(data.attendees);
  }, [eventId, groupIds, includeChildGroups]);
  useEffect(() => { reloadBase().catch((e) => setError(e.message)); }, [reloadBase]);
  useEffect(() => { reloadRoster().catch((e) => setError(e.message)); }, [reloadRoster]);
  const shown = useMemo(() => attendees.filter((person) => (!presentOnly || Boolean(person.checkedInAt)) && `${person.firstName} ${person.lastName} ${person.groups.join(" ")}`.toLowerCase().includes(query.toLowerCase())).sort((a,b) => sort === "group" ? a.groups.join().localeCompare(b.groups.join()) || a.lastName.localeCompare(b.lastName) : sort === "present" ? Number(Boolean(b.checkedInAt))-Number(Boolean(a.checkedInAt)) || a.lastName.localeCompare(b.lastName) : a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)), [attendees, presentOnly, query, sort]);
  const mark = async (person: Attendee, present: boolean) => {
    setBusy(true); setError(""); try { const response = await fetch(`/api/modules/check-in/events/${eventId}/attendees/${person.id}`, { method: "PUT", credentials: "include", headers: { "content-type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify({ present, firstTimeVisitor: person.firstTimeVisitor, groupIds, includeChildGroups }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Could not update attendance."); await reloadRoster(); } catch (e) { setError(e instanceof Error ? e.message : "Update failed."); } finally { setBusy(false); }
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
      const checkedIn = await checkInResponse.json() as { error?: string };
      if (!checkInResponse.ok) throw new Error(checkedIn.error ?? "The visitor was saved but could not be checked in. Try again from this roster.");
      setVisitorDialogOpen(false); form.reset(); await reloadRoster();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add this visitor."); }
    finally { setVisitorBusy(false); }
  };
  const openPickupEditor = (person: Attendee) => { setPickupEditor(person); setPickupContactIds(person.authorizedPickups.map((item) => item.id)); setGuardianConfirmed(false); };
  const savePickups = async () => {
    if (!pickupEditor || !eventId) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/modules/check-in/events/${eventId}/attendees/${pickupEditor.id}/pickups`, { method: "PUT", credentials: "include", headers: { "content-type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify({ groupIds, includeChildGroups, authorizedContactIds: pickupContactIds, guardianConfirmed }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Could not save pickup contacts.");
      setPickupEditor(null); await reloadRoster();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save pickup contacts."); }
    finally { setBusy(false); }
  };
  const selected = events.find((e) => e.id === eventId); const presentCount = attendees.filter((p) => p.checkedInAt).length;
  const complete = Boolean(selected?.completedAt);
  const toggleComplete = async () => {
    if (!eventId) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/modules/check-in/events/${eventId}/session`, { method: "PUT", credentials: "include", headers: { "content-type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify({ complete: !complete }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Could not update the meeting check-in state."); await reloadBase();
    } catch (e) { setError(e instanceof Error ? e.message : "Update failed."); }
    finally { setBusy(false); }
  };
  return <main className="checkin-module">
    <header className="checkin-heading"><div><p className="checkin-eyebrow">WELCOME DESK</p><h1>Check-in</h1><p>Choose a meeting and groups to build a shared attendee roster.</p></div><button className="checkin-print" onClick={() => window.print()} disabled={!shown.length}><Printer size={17}/> Print labels / pickup slips</button></header>
    {error && <div className="checkin-error" role="alert">{error}</div>}
    <section className="checkin-setup"><label>Meeting<select value={eventId} onChange={(e) => setEventId(e.target.value)}><option value="">Select a meeting…</option>{events.map((event) => <option value={event.id} key={event.id}>{event.eventDate} · {event.startTime.slice(0,5)} · {event.title}{event.completedAt ? " · completed" : ""}</option>)}</select></label>
      <fieldset><legend>Groups and age subgroups</legend><div className="checkin-groups">{groups.map((group) => <label key={group.id} className={groupIds.includes(group.id) ? "selected" : ""}><input type="checkbox" checked={groupIds.includes(group.id)} onChange={() => setGroupIds((prev) => prev.includes(group.id) ? prev.filter((id) => id !== group.id) : [...prev, group.id])}/><span>{group.parentGroupId ? "↳ " : ""}{group.name}</span><small>{group.memberCount}</small></label>)}</div>{hierarchyAvailable&&<label className="checkin-descendant-option"><input type="checkbox" checked={includeChildGroups} onChange={e=>setIncludeChildGroups(e.target.checked)}/> Include members of child groups</label>}</fieldset>
      {selected && <p className="checkin-event-meta">{selected.location} <span>·</span> {selected.kind}</p>}
    </section>
    <section className="checkin-toolbar"><strong><Users size={17}/> {presentCount} of {attendees.length} present</strong><label className="checkin-search"><Search size={17}/><input placeholder="Search people or groups" value={query} onChange={(e) => setQuery(e.target.value)}/></label><label className="checkin-sort">Sort <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}><option value="name">Name</option><option value="group">Group</option><option value="present">Present first</option></select><ChevronDown size={14}/></label><label className="checkin-present"><input type="checkbox" checked={presentOnly} onChange={(e) => setPresentOnly(e.target.checked)}/> Present only</label>{canAddVisitor && eventId && groupIds.length > 0 && <button className="checkin-pickup-edit" type="button" onClick={() => setVisitorDialogOpen(true)} disabled={busy || visitorBusy}><UserPlus size={15}/> Add visitor</button>}</section>
    {!eventId || !groupIds.length ? <div className="checkin-empty">Select a meeting and at least one group to see its roster.</div> : <div className="checkin-roster">{shown.map((person) => <article className={`checkin-person ${person.checkedInAt ? "is-present" : ""}`} key={person.id}><div className="checkin-avatar">{person.firstName.slice(0,1)}{person.lastName.slice(0,1)}</div><div className="checkin-person-info"><strong>{person.firstName} {person.lastName}</strong><small>{person.groups.join(" · ")}</small>{person.phone && <small>{person.phone}</small>}{person.authorizedPickups.length > 0 && <small>Authorized pickup: {person.authorizedPickups.map((item) => item.name).join(", ")}</small>}</div>{canManage && !person.isVisitor && <button className="checkin-pickup-edit" type="button" onClick={() => openPickupEditor(person)}>Pickup contacts</button>}<button className={person.checkedInAt ? "checkin-reset" : "checkin-mark"} disabled={busy || complete} onClick={() => mark(person, !person.checkedInAt)}>{person.checkedInAt ? <><RotateCcw size={15}/> Undo</> : <><Check size={16}/> Present</>}</button></article>)}{!shown.length && <div className="checkin-empty">No attendees match this view.</div>}</div>}
    <footer className="checkin-footer"><span>{complete ? `Meeting check-in completed${selected?.completedAt ? ` · ${new Date(selected.completedAt).toLocaleString()}` : ""}` : "Attendance is saved as people arrive."}</span><button onClick={() => void toggleComplete()} disabled={!eventId || busy}>{complete ? "Reopen check-in" : "Complete check-in"}</button></footer>
    <div className="checkin-print-area" aria-hidden="true">{shown.map((person) => <article key={person.id}><strong>{person.firstName} {person.lastName}</strong><span>{person.groups.join(" · ")}</span><small>{selected?.title} · Pickup: {person.authorizedPickups.length ? person.authorizedPickups.map((item) => item.name).join(", ") : "__________________"}</small></article>)}</div>
    {pickupEditor && <div className="checkin-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPickupEditor(null)}><section className="checkin-pickup-dialog" role="dialog" aria-modal="true" aria-labelledby="checkin-pickup-title"><header><div><h2 id="checkin-pickup-title">Authorized pickup contacts</h2><p>{pickupEditor.firstName} {pickupEditor.lastName} · {selected?.title}</p></div><button type="button" onClick={() => setPickupEditor(null)} aria-label="Close">×</button></header><p>Choose roster contacts a parent or guardian has authorized to collect this child. This records who confirmed the list and when; it does not verify the authorization independently. Only event or group managers can edit it.</p><div className="checkin-pickup-options">{attendees.filter((person) => person.id !== pickupEditor.id && !person.isVisitor).map((person) => <label key={person.id}><input type="checkbox" checked={pickupContactIds.includes(person.id)} onChange={() => setPickupContactIds((current) => current.includes(person.id) ? current.filter((id) => id !== person.id) : [...current, person.id])} /><span>{person.firstName} {person.lastName}</span></label>)}</div><label className="checkin-guardian-confirm"><input type="checkbox" checked={guardianConfirmed} onChange={(event) => setGuardianConfirmed(event.target.checked)} /><span>I confirmed this pickup list with the parent or guardian.</span></label><div className="checkin-pickup-actions"><button type="button" onClick={() => setPickupEditor(null)}>Cancel</button><button type="button" disabled={busy || !guardianConfirmed} onClick={() => void savePickups()}>Save pickup contacts</button></div></section></div>}
    {visitorDialogOpen && <div className="checkin-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setVisitorDialogOpen(false)}><form className="checkin-pickup-dialog" role="dialog" aria-modal="true" aria-labelledby="checkin-visitor-title" onSubmit={(event) => void addVisitor(event)}><header><div><h2 id="checkin-visitor-title">Add a walk-in visitor</h2><p>{selected?.title} · {selected?.eventDate}</p></div><button type="button" onClick={() => setVisitorDialogOpen(false)} aria-label="Close">×</button></header><p>Creates a visitor contact in this location and checks them in as a first-time visitor. Possible duplicate people are blocked.</p><label>First name<input name="firstName" required maxLength={80} autoFocus /></label><label>Last name<input name="lastName" required maxLength={80} /></label><label>Email <span className="optional-label">Optional</span><input name="email" type="email" maxLength={254} /></label><label>Phone <span className="optional-label">Optional</span><input name="phone" type="tel" maxLength={40} /></label><div className="checkin-pickup-actions"><button type="button" onClick={() => setVisitorDialogOpen(false)}>Cancel</button><button type="submit" disabled={visitorBusy || busy}><UserPlus size={15}/> {visitorBusy ? "Adding…" : "Add and check in"}</button></div></form></div>}
  </main>;
}
