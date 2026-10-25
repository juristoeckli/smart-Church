import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, CalendarDays, Check, Clock3, MapPin, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import type { BookableResource, Contact, CreateServiceEvent, ServiceEvent, ServiceEventKind, ServicePlanItem, ServicePosition } from "@smart-church/contracts";

type EventFilter = "upcoming" | "all" | "past";

const eventKinds: { value: ServiceEventKind; label: string }[] = [
  { value: "service", label: "Worship service" },
  { value: "meeting", label: "Meeting" },
  { value: "community", label: "Community event" },
  { value: "other", label: "Other" },
];

function departmentDateString(timeZone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatEventDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T12:00:00Z`));
}

function formatShortDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return {
    day: new Intl.DateTimeFormat("en-GB", { day: "2-digit", timeZone: "UTC" }).format(date),
    month: new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(date).toUpperCase(),
  };
}

function eventKindLabel(kind: ServiceEventKind) {
  return eventKinds.find((item) => item.value === kind)?.label ?? "Other";
}

function eventPayload(form: HTMLFormElement): CreateServiceEvent {
  const values = new FormData(form);
  const endTime = String(values.get("endTime")).trim();
  const description = String(values.get("description")).trim();
  return {
    title: String(values.get("title")).trim(),
    kind: String(values.get("kind")) as ServiceEventKind,
    eventDate: String(values.get("eventDate")),
    startTime: String(values.get("startTime")),
    ...(endTime ? { endTime } : {}),
    location: String(values.get("location")).trim(),
    ...(description ? { description } : {}),
  };
}

export function ServicesEvents({ departmentId, departmentLocation, departmentTimeZone, contacts, canManage, onNotice }: { departmentId: string; departmentLocation: string; departmentTimeZone: string; contacts: Contact[]; canManage: boolean; onNotice: (message: string) => void }) {
  const [events, setEvents] = useState<ServiceEvent[]>([]);
  const [resources, setResources] = useState<BookableResource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState<EventFilter>("upcoming");
  const [query, setQuery] = useState("");
  const [editingEvent, setEditingEvent] = useState<ServiceEvent | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [room, setRoom] = useState("");
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [positions, setPositions] = useState<ServicePosition[]>([]);
  const [timePlan, setTimePlan] = useState<ServicePlanItem[]>([]);

  async function loadEvents(signal?: AbortSignal) {
    setIsLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/events", { headers: { "x-department-id": departmentId }, signal });
      const result = await response.json() as ServiceEvent[] | { error?: string };
      if (!response.ok || !Array.isArray(result)) {
        throw new Error(!Array.isArray(result) ? result.error ?? "Could not load services and events." : "Could not load services and events.");
      }
      setEvents(result);
      const resourceResponse = await fetch("/api/resources", { headers: { "x-department-id": departmentId }, signal });
      const resourceData = await resourceResponse.json() as BookableResource[];
      if (resourceResponse.ok && Array.isArray(resourceData)) setResources(resourceData.filter((resource) => resource.active));
    } catch (error) {
      if (!signal?.aborted) setLoadError(error instanceof Error ? error.message : "Could not load services and events.");
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadEvents(controller.signal);
    return () => controller.abort();
  }, [departmentId]);

  const today = departmentDateString(departmentTimeZone);
  const currentMonth = today.slice(0, 7);
  const upcomingEvents = useMemo(() => events.filter((event) => event.eventDate >= today), [events, today]);
  const thisMonthCount = events.filter((event) => event.eventDate.startsWith(currentMonth) && event.eventDate >= today).length;
  const filteredEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = events.filter((event) => {
      const matchesFilter = filter === "all" || (filter === "upcoming" ? event.eventDate >= today : event.eventDate < today);
      const matchesQuery = !normalizedQuery || [event.title, event.location, eventKindLabel(event.kind), event.description]
        .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
      return matchesFilter && matchesQuery;
    });
    return filter === "past" ? filtered.reverse() : filtered;
  }, [events, filter, query, today]);

  function openCreateModal() {
    setEditingEvent(null);
    setRoom(""); setAssetIds([]); setPositions([{ name: "Tech" }, { name: "Band" }, { name: "Preacher" }, { name: "Moderation" }]); setTimePlan([]);
    setIsModalOpen(true);
  }

  function openEditModal(event: ServiceEvent) {
    setEditingEvent(event);
    setRoom(event.room ?? ""); setAssetIds(event.assetIds ?? []); setPositions(event.positions ?? []); setTimePlan(event.timePlan ?? []);
    setIsModalOpen(true);
  }

  async function saveEvent(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = formEvent.currentTarget;
    const payload: CreateServiceEvent = { ...eventPayload(form), room, assetIds, positions: positions.filter((position) => position.name.trim()), timePlan: timePlan.filter((item) => item.title.trim()).map((item) => ({ ...item, durationMinutes: item.durationMinutes ? Number(item.durationMinutes) : undefined })) };
    setIsSaving(true);
    try {
      const response = await fetch(editingEvent ? `/api/events/${editingEvent.id}` : "/api/events", {
        method: editingEvent ? "PUT" : "POST",
        headers: { "content-type": "application/json", "x-department-id": departmentId },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as ServiceEvent | { error?: string };
      if (!response.ok || !("id" in result)) throw new Error("error" in result ? result.error ?? "Could not save this event." : "Could not save this event.");
      setEvents((current) => editingEvent
        ? current.map((item) => item.id === result.id ? result : item)
        : [...current, result].sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.startTime.localeCompare(b.startTime)));
      setIsModalOpen(false);
      setEditingEvent(null);
      form.reset();
      onNotice(editingEvent ? `${result.title} was updated.` : `${result.title} was added to the schedule.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not save this event.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteEvent(event: ServiceEvent) {
    if (!window.confirm(`Delete “${event.title}” from the schedule?`)) return;
    try {
      const response = await fetch(`/api/events/${event.id}`, { method: "DELETE", headers: { "x-department-id": departmentId } });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not delete this event.");
      setEvents((current) => current.filter((item) => item.id !== event.id));
      onNotice(`${event.title} was removed from the schedule.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not delete this event.");
    }
  }

  return (
    <>
      <div className={`demo-notice ${loadError ? "demo-notice-error" : ""}`}>
        <span className="demo-dot" />
        {loadError ? `Events unavailable · ${loadError}` : `Local workspace · Services and events are saved for ${departmentLocation}`}
        {loadError && <button className="event-retry" type="button" onClick={() => void loadEvents()}>Try again</button>}
      </div>

      <section className="page-heading">
        <div>
          <div className="eyebrow">GATHER AND CONNECT</div>
          <h1>Services &amp; events</h1>
          <p className="page-subtitle">Keep your church gatherings and community moments in one shared schedule.</p>
        </div>
        {canManage && <button className="button button-primary" type="button" onClick={openCreateModal}><Plus size={18} /> Add event</button>}
      </section>

      <section className="stat-grid event-stat-grid" aria-label="Schedule summary">
        <article className="stat-card"><div className="stat-icon stat-icon-green"><CalendarDays size={19} /></div><div className="stat-content"><span>Upcoming events</span><strong>{upcomingEvents.length}</strong><small>From today onwards</small></div></article>
        <article className="stat-card"><div className="stat-icon stat-icon-blue"><Clock3 size={19} /></div><div className="stat-content"><span>This month</span><strong>{thisMonthCount}</strong><small>Still to come</small></div></article>
        <article className="stat-card event-next-card"><div className="stat-icon stat-icon-amber"><MapPin size={19} /></div><div className="stat-content"><span>Next gathering</span><strong className="event-next-title">{upcomingEvents[0]?.title ?? "Nothing planned yet"}</strong><small>{upcomingEvents[0] ? `${formatEventDate(upcomingEvents[0].eventDate)} · ${upcomingEvents[0].startTime}` : "Add your first service or event"}</small></div></article>
        {canManage && <button className="stat-card stat-card-action event-create-card" type="button" onClick={openCreateModal}><span className="import-icon"><Plus size={19} /></span><span className="stat-content"><span>Planning ahead</span><strong className="stat-action-title">Schedule a gathering</strong><small>Add it for your community</small></span><span className="card-arrow">↗</span></button>}
      </section>

      <section className="directory-card">
        <div className="directory-heading"><div><h2>Church schedule</h2><p>Services, meetings, and events for this location.</p></div></div>
        <div className="directory-toolbar event-toolbar">
          <div className="search-field"><Search size={17} /><input aria-label="Search services and events" placeholder="Search by title, type, or location..." value={query} onChange={(event) => setQuery(event.target.value)} /></div>
          <div className="filter-tabs" role="tablist" aria-label="Filter schedule">
            <button className={filter === "upcoming" ? "filter-tab filter-tab-active" : "filter-tab"} type="button" role="tab" aria-selected={filter === "upcoming"} onClick={() => setFilter("upcoming")}>Upcoming <span>{upcomingEvents.length}</span></button>
            <button className={filter === "all" ? "filter-tab filter-tab-active" : "filter-tab"} type="button" role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>All <span>{events.length}</span></button>
            <button className={filter === "past" ? "filter-tab filter-tab-active" : "filter-tab"} type="button" role="tab" aria-selected={filter === "past"} onClick={() => setFilter("past")}>Past <span>{events.filter((event) => event.eventDate < today).length}</span></button>
          </div>
        </div>

        <div className="table-scroll"><table className="people-table event-table"><thead><tr><th>DATE</th><th>GATHERING</th><th>TIME</th><th>LOCATION</th><th>TYPE</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
          {filteredEvents.map((event) => {
            const date = formatShortDate(event.eventDate);
            return <tr key={event.id}><td><div className="event-date-badge"><strong>{date.day}</strong><span>{date.month}</span></div></td><td><div className="event-name-cell"><strong>{event.title}</strong>{event.importedFrom === "churchtools" && <small>ChurchTools · read-only</small>}{event.description && <small>{event.description}</small>}{Boolean(event.positions?.length) && <small>Positions: {event.positions!.map((position) => { const person = contacts.find((contact) => contact.id === position.contactId); return position.name + (person ? ": " + person.firstName + " " + person.lastName : ""); }).join(", ")}</small>}{Boolean(event.timePlan?.length) && <small>Time plan: {event.timePlan!.map((item) => (item.startTime ? item.startTime + " " : "") + item.title + (item.durationMinutes ? " (" + item.durationMinutes + " min)" : "")).join(" → ")}</small>}{Boolean(event.assetIds?.length) && <small>Assets: {resources.filter((resource) => event.assetIds!.includes(resource.id)).map((resource) => resource.name).join(", ")}</small>}</div></td><td className="event-time-cell">{event.startTime}{event.endTime ? ` – ${event.endTime}` : ""}</td><td><span className="event-location-cell"><MapPin size={13} />{event.location}{event.room ? " · " + event.room : ""}</span></td><td><span className={`event-kind event-kind-${event.kind}`}>{eventKindLabel(event.kind)}</span></td><td>{canManage && !event.importedFrom && <div className="event-actions"><button className="event-action" type="button" aria-label={`Edit ${event.title}`} onClick={() => openEditModal(event)}><Pencil size={15} /></button><button className="event-action event-delete-action" type="button" aria-label={`Delete ${event.title}`} onClick={() => void deleteEvent(event)}><Trash2 size={15} /></button></div>}</td></tr>;
          })}
          {filteredEvents.length === 0 && <tr><td colSpan={6} className="empty-state">{isLoading ? "Loading the schedule…" : loadError ? "The schedule could not be loaded." : query ? "No gatherings match your search." : filter === "past" ? "There are no past gatherings yet." : "No gatherings scheduled. Add your first service or event."}</td></tr>}
        </tbody></table></div>
        <footer className="table-footer"><span>Showing <strong>{filteredEvents.length}</strong> of <strong>{events.length}</strong> gatherings</span><span className="event-footer-note">Times use {departmentTimeZone}.</span></footer>
      </section>

      <footer className="page-footer"><span>Make room for what brings us together.</span><span>© 2026 Smart Church</span></footer>

      {isModalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setIsModalOpen(false)}><section className="modal event-modal" role="dialog" aria-modal="true" aria-labelledby="event-modal-title"><div className="modal-heading"><div><span className="eyebrow">CHURCH SCHEDULE</span><h2 id="event-modal-title">{editingEvent ? "Edit gathering" : "Add a gathering"}</h2><p>Share the details so everyone knows when and where to meet.</p></div><button className="icon-button" type="button" aria-label="Close dialog" onClick={() => setIsModalOpen(false)}><X size={19} /></button></div><form key={editingEvent?.id ?? "new-event"} onSubmit={saveEvent}>
        <label>Title<input name="title" autoFocus required maxLength={160} defaultValue={editingEvent?.title ?? ""} placeholder="Sunday worship service" /></label>
        <div className="form-row"><label>Type<select name="kind" defaultValue={editingEvent?.kind ?? "service"}>{eventKinds.map((kind) => <option value={kind.value} key={kind.value}>{kind.label}</option>)}</select></label><label>Location / building<input name="location" required maxLength={160} defaultValue={editingEvent?.location ?? departmentLocation} placeholder="Church building" /></label><label>Room<input maxLength={160} value={room} onChange={(event) => setRoom(event.target.value)} placeholder="Main hall" /></label></div>
        <div className="form-row event-time-row"><label>Date<input type="date" name="eventDate" required defaultValue={editingEvent?.eventDate ?? departmentDateString(departmentTimeZone)} /></label><label>Starts at<input type="time" name="startTime" required defaultValue={editingEvent?.startTime ?? "10:00"} /></label><label>Ends at <span className="optional-label">Optional</span><input type="time" name="endTime" defaultValue={editingEvent?.endTime ?? ""} /></label></div>
        <label>Description <span className="optional-label">Optional</span><textarea name="description" maxLength={2000} rows={3} defaultValue={editingEvent?.description ?? ""} placeholder="A few helpful details for the community" /></label>
        <section className="service-planning-section"><div className="service-planning-heading"><div><h3>Assets</h3><p>Rooms and equipment already listed in Resources.</p></div></div>{resources.length ? <div className="service-asset-list">{resources.map((resource) => <label key={resource.id}><input type="checkbox" checked={assetIds.includes(resource.id)} onChange={(event) => setAssetIds((current) => event.target.checked ? [...current, resource.id] : current.filter((id) => id !== resource.id))} /><span>{resource.name}<small>{resource.category}{resource.location ? " · " + resource.location : ""}</small></span></label>)}</div> : <p className="service-planning-empty">Add rooms or equipment in Resources to attach them here.</p>}</section>
        <section className="service-planning-section"><div className="service-planning-heading"><div><h3>Positions</h3><p>Assign tech, band, preacher, moderation, and other roles.</p></div><button className="button button-secondary" type="button" onClick={() => setPositions((current) => [...current, { name: "" }])}><Plus size={14} />Add position</button></div>{positions.length ? <div className="service-position-list">{positions.map((position, index) => <div className="service-position-row" key={index}><input aria-label="Position name" required placeholder="e.g. Preacher" value={position.name} onChange={(event) => setPositions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /><select aria-label="Assigned person" value={position.contactId ?? ""} onChange={(event) => setPositions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, contactId: event.target.value || undefined } : item))}><option value="">Unassigned</option>{contacts.map((person) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>)}</select><button className="community-row-action community-row-delete" type="button" aria-label="Remove position" onClick={() => setPositions((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button></div>)}</div> : <p className="service-planning-empty">Add the people and roles needed for this service.</p>}</section>
        <section className="service-planning-section"><div className="service-planning-heading"><div><h3>Time plan</h3><p>Arrange service moments in the order they will happen.</p></div><button className="button button-secondary" type="button" onClick={() => setTimePlan((current) => [...current, { title: "" }])}><Plus size={14} />Add item</button></div>{timePlan.length ? <div className="service-timeplan-list">{timePlan.map((item, index) => <div className="service-timeplan-row" key={index}><input aria-label="Time plan item" required placeholder="e.g. Welcome and opening song" value={item.title} onChange={(event) => setTimePlan((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, title: event.target.value } : entry))} /><input aria-label="Start time" type="time" value={item.startTime ?? ""} onChange={(event) => setTimePlan((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, startTime: event.target.value || undefined } : entry))} /><input aria-label="Duration in minutes" type="number" min="1" max="1440" placeholder="Minutes" value={item.durationMinutes ?? ""} onChange={(event) => setTimePlan((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, durationMinutes: event.target.value ? Number(event.target.value) : undefined } : entry))} /><div className="service-timeplan-order"><button className="community-row-action" type="button" aria-label="Move item up" disabled={index === 0} onClick={() => setTimePlan((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}><ArrowUp size={14} /></button><button className="community-row-action" type="button" aria-label="Move item down" disabled={index === timePlan.length - 1} onClick={() => setTimePlan((current) => { const next = [...current]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next; })}><ArrowDown size={14} /></button><button className="community-row-action community-row-delete" type="button" aria-label="Remove time plan item" onClick={() => setTimePlan((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></button></div><input className="service-timeplan-notes" aria-label="Time plan notes" placeholder="Notes (optional)" value={item.notes ?? ""} onChange={(event) => setTimePlan((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, notes: event.target.value } : entry))} /></div>)}</div> : <p className="service-planning-empty">Build an ordered plan for the service.</p>}</section>
        <div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setIsModalOpen(false)}>Cancel</button><button className="button button-primary" type="submit" disabled={isSaving}><Check size={16} /> {isSaving ? "Saving…" : editingEvent ? "Save changes" : "Add to schedule"}</button></div>
      </form></section></div>}
    </>
  );
}
