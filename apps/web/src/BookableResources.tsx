import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Building2, CalendarDays, Check, Clock3, Plus, Trash2 } from "lucide-react";
import type { BookableResource, ResourceBooking } from "@smart-church/contracts";
import { formatUserDate } from "./date-format";

type Draft = { name: string; category: BookableResource["category"]; description: string; location: string; capacity: string; requiresApproval: boolean; active: boolean };
const emptyDraft: Draft = { name: "", category: "room", description: "", location: "", capacity: "", requiresApproval: true, active: true };
function localDateTime(value: string) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function displayDate(value: string) { return formatUserDate(value, true); }

export function BookableResources({ departmentId, userId, canManage }: { departmentId: string; userId: string; canManage: boolean }) {
  const [resources, setResources] = useState<BookableResource[]>([]);
  const [bookings, setBookings] = useState<ResourceBooking[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [purpose, setPurpose] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selected = resources.find((item) => item.id === selectedId) ?? null;
  const visibleResources = useMemo(() => resources.filter((item) => canManage || item.active), [resources, canManage]);
  const selectedBookings = useMemo(() => bookings.filter((item) => item.resourceId === selectedId), [bookings, selectedId]);

  async function load(signal?: AbortSignal) {
    setLoading(true); setError("");
    try {
      const headers = { "x-department-id": departmentId };
      const responses = await Promise.all([fetch("/api/resources", { headers, signal }), fetch("/api/resource-bookings", { headers, signal })]);
      const data = await Promise.all(responses.map((response) => response.json()));
      if (!responses[0].ok || !Array.isArray(data[0])) throw new Error(data[0].error ?? "Could not load resources.");
      if (!responses[1].ok || !Array.isArray(data[1])) throw new Error(data[1].error ?? "Could not load bookings.");
      setResources(data[0] as BookableResource[]); setBookings(data[1] as ResourceBooking[]);
      setSelectedId((current) => data[0].some((item: BookableResource) => item.id === current) ? current : data[0].find((item: BookableResource) => item.active)?.id ?? data[0][0]?.id ?? "");
    } catch (reason) { if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "Could not load resources."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [departmentId]);
  useEffect(() => {
    setDraft(selected ? { name: selected.name, category: selected.category, description: selected.description, location: selected.location, capacity: selected.capacity ? String(selected.capacity) : "", requiresApproval: selected.requiresApproval, active: selected.active } : emptyDraft);
  }, [selectedId, selected?.name, selected?.category, selected?.description, selected?.location, selected?.capacity, selected?.requiresApproval, selected?.active]);

  async function saveResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch(selected ? "/api/resources/" + selected.id : "/api/resources", {
        method: selected ? "PUT" : "POST", headers: { "content-type": "application/json", "x-department-id": departmentId },
        body: JSON.stringify({ ...draft, capacity: draft.capacity ? Number(draft.capacity) : undefined }),
      });
      const result = await response.json() as BookableResource | { error?: string };
      if (!response.ok || !("id" in result)) throw new Error("error" in result ? result.error ?? "Could not save resource." : "Could not save resource.");
      setResources((current) => selected ? current.map((item) => item.id === result.id ? result : item) : [...current, result].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedId(result.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save resource."); }
    finally { setSaving(false); }
  }

  async function bookResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/resource-bookings", { method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify({ resourceId: selected.id, purpose, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString() }) });
      const result = await response.json() as ResourceBooking | { error?: string };
      if (!response.ok || !("id" in result)) throw new Error("error" in result ? result.error ?? "Could not request this resource." : "Could not request this resource.");
      setBookings((current) => [...current, result].sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
      setPurpose(""); setStartsAt(""); setEndsAt("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not request this resource."); }
    finally { setSaving(false); }
  }

  async function changeBooking(booking: ResourceBooking, status: "approved" | "declined" | "cancelled") {
    setError("");
    try {
      const response = await fetch("/api/resource-bookings/" + booking.id + "/status", { method: "PUT", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify({ status }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not update booking.");
      if (status !== "approved") setBookings((current) => current.filter((item) => item.id !== booking.id));
      else setBookings((current) => current.map((item) => item.id === booking.id ? { ...item, status } : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update booking."); }
  }

  async function archiveResource(resource: BookableResource) {
    if (!window.confirm("Remove “" + resource.name + "” from available resources? Existing bookings will be kept.")) return;
    try {
      const response = await fetch("/api/resources/" + resource.id, { method: "DELETE", headers: { "x-department-id": departmentId } });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not archive resource.");
      setResources((current) => current.map((item) => item.id === resource.id ? { ...item, active: false } : item));
      setSelectedId(resources.find((item) => item.id !== resource.id && item.active)?.id ?? "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not archive resource."); }
  }

  const resourceForm = (creating: boolean) => <form className="community-bookable-form" onSubmit={saveResource}>
    <label>Name<input required maxLength={120} autoFocus={creating} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. Meeting room A" /></label>
    <label>Type<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as Draft["category"] })}><option value="room">Meeting room</option><option value="vehicle">Vehicle</option><option value="equipment">Equipment</option><option value="other">Other</option></select></label>
    <label>Location<input maxLength={160} value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} /></label>
    <label>Capacity<input type="number" min="1" max="10000" value={draft.capacity} onChange={(event) => setDraft({ ...draft, capacity: event.target.value })} /></label>
    <label className="community-resource-description">Description<textarea rows={2} maxLength={1000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
    <label className="community-resource-check"><input type="checkbox" checked={draft.requiresApproval} onChange={(event) => setDraft({ ...draft, requiresApproval: event.target.checked })} />Booking requests need approval</label>
    {!creating && <label className="community-resource-check"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />Available to book</label>}
    <button className="button button-primary" type="submit" disabled={saving || !draft.name.trim()}>{creating ? <Plus size={15} /> : <Check size={14} />}{creating ? "Create resource" : "Save details"}</button>
  </form>;

  return <>
    <div className={"demo-notice " + (error ? "demo-notice-error" : "")}><span className="demo-dot" />{error || "Manage shared spaces, vehicles, and equipment."}{error && <button className="event-retry" type="button" onClick={() => void load()}>Try again</button>}</div>
    <section className="page-heading"><div><div className="eyebrow">BOOKABLE CHURCH ASSETS</div><h1>Resources</h1><p className="page-subtitle">Manage meeting rooms, cars, and equipment, then request a time to use them.</p></div>{canManage && <button className="button button-primary" type="button" onClick={() => { setSelectedId(""); setDraft(emptyDraft); }}><Plus size={16} /> Add resource</button>}</section>
    <section className="community-groups-layout community-resources-layout">
      <section className="directory-card community-group-list"><div className="directory-heading"><div><h2>Available resources</h2><p>{visibleResources.filter((item) => item.active).length} available</p></div></div>{loading ? <p className="community-empty">Loading resources…</p> : visibleResources.length ? <div className="community-group-options">{visibleResources.map((item) => <button type="button" key={item.id} className={"community-group-option" + (item.id === selectedId ? " is-active" : "")} onClick={() => setSelectedId(item.id)}><span className="community-group-icon"><Building2 size={17} /></span><span><strong>{item.name}</strong><small>{item.category}{item.active ? "" : " · Archived"}{item.importedFrom ? " · ChurchTools" : ""}</small></span></button>)}</div> : <p className="community-empty">No resources are listed yet.</p>}</section>
      <div className="community-resource-detail">
        {canManage && !selected?.importedFrom && <section className="directory-card"><div className="directory-heading"><div><h2>{selected ? "Resource details" : "Add a resource"}</h2><p>{selected ? selected.active ? "Edit availability and booking preferences." : "Archived resource · it can be made available again." : "List a space, vehicle, or other shared item."}</p></div>{selected?.active && <button className="button button-danger" type="button" onClick={() => void archiveResource(selected)}><Trash2 size={14} />Archive</button>}</div>{resourceForm(!selected)}</section>}
        {selected?.active && <section className="directory-card"><div className="directory-heading"><div><h2>Request a booking</h2><p>{selected.importedFrom ? "Imported from ChurchTools · read-only details · " : ""}{selected.location || "Church resource"}{selected.capacity ? " · Capacity " + selected.capacity : ""}</p></div></div><form className="community-booking-form" onSubmit={bookResource}><label>What is it for?<input required maxLength={240} value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Meeting, event, or purpose" /></label><label>Starts<input required type="datetime-local" min={localDateTime(new Date().toISOString())} value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label>Ends<input required type="datetime-local" min={startsAt || localDateTime(new Date().toISOString())} value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label><button className="button button-primary" type="submit" disabled={saving || !startsAt || !endsAt}><CalendarDays size={15} />Request</button></form></section>}
        {selected && <section className="directory-card"><div className="directory-heading"><div><h2>Bookings</h2><p>Requests and reservations for {selected.name}.</p></div></div>{selectedBookings.length ? <div className="community-booking-list">{selectedBookings.map((booking) => <article className="community-booking-row" key={booking.id}><span className="community-resource-icon"><Clock3 size={17} /></span><div className="community-resource-title"><strong>{booking.purpose}</strong><small>{displayDate(booking.startsAt)}–{displayDate(booking.endsAt)} · {booking.requesterName}</small><span className={"community-booking-status status-" + booking.status}>{booking.status}</span></div>{canManage && booking.status === "requested" && <><button className="community-row-action" aria-label="Approve booking" title="Approve" type="button" onClick={() => void changeBooking(booking, "approved")}><Check size={16} /></button><button className="community-row-action community-row-delete" aria-label="Decline booking" title="Decline" type="button" onClick={() => void changeBooking(booking, "declined")}><Trash2 size={15} /></button></>}{(canManage || booking.requestedBy === userId) && <button className="community-row-action" aria-label="Cancel booking" title="Cancel" type="button" onClick={() => void changeBooking(booking, "cancelled")}>×</button>}</article>)}</div> : <p className="community-empty">No upcoming bookings.</p>}</section>}
      </div>
    </section>
    <footer className="page-footer"><span>Shared spaces and tools, coordinated in one place.</span><span>© 2026 Smart Church</span></footer>
  </>;
}
