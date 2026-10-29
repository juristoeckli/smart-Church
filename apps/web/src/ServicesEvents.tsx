import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CalendarDays, Check, ClipboardList, Clock3, Link2, MapPin, Pencil, Plus, Repeat2, Search, Trash2, UserCheck, Users, X } from "lucide-react";
import type { BookableResource, Contact, CreateServiceEvent, EventRegistration, ServiceEvent, ServiceEventCheckIn, ServiceEventKind, ServicePlanItem, ServicePosition, VisitorFollowUp } from "@smart-church/contracts";

type EventFilter = "upcoming" | "all" | "past";
type ScheduleView = "list" | "month";

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

function preservePositionResponses(event: ServiceEvent, previous?: ServiceEvent): ServiceEvent {
  return {
    ...event,
    positions: event.positions?.map((position, index) => {
      const oldPosition = previous?.positions?.[index];
      const sameAssignment = oldPosition?.contactId === position.contactId;
      return {
        ...position,
        responseStatus: sameAssignment ? oldPosition?.responseStatus ?? (position.contactId ? "pending" : undefined) : position.contactId ? "pending" : undefined,
        canRespond: sameAssignment ? Boolean(oldPosition?.canRespond) : false,
      };
    }),
  };
}

function eventPayload(form: HTMLFormElement): CreateServiceEvent {
  const values = new FormData(form);
  const endTime = String(values.get("endTime")).trim();
  const description = String(values.get("description")).trim();
  const recurrenceInterval = String(values.get("recurrence") ?? "");
  return {
    title: String(values.get("title")).trim(),
    kind: String(values.get("kind")) as ServiceEventKind,
    eventDate: String(values.get("eventDate")),
    startTime: String(values.get("startTime")),
    ...(endTime ? { endTime } : {}),
    location: String(values.get("location")).trim(),
    ...(description ? { description } : {}),
    registrationEnabled: values.get("registrationEnabled") === "on",
    ...(values.get("registrationCapacity") ? { registrationCapacity: Number(values.get("registrationCapacity")) } : {}),
    ...(recurrenceInterval ? { recurrence: { interval: recurrenceInterval as "weekly" | "biweekly" | "monthly", endDate: String(values.get("recurrenceEndDate")) } } : {}),
  };
}

export function ServicesEvents({ departmentId, departmentLocation, departmentTimeZone, contacts, canManage, onNotice }: { departmentId: string; departmentLocation: string; departmentTimeZone: string; contacts: Contact[]; canManage: boolean; onNotice: (message: string) => void }) {
  const [events, setEvents] = useState<ServiceEvent[]>([]);
  const [resources, setResources] = useState<BookableResource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState<EventFilter>("upcoming");
  const [scheduleView, setScheduleView] = useState<ScheduleView>("list");
  const [calendarMonth, setCalendarMonth] = useState(() => departmentDateString(departmentTimeZone).slice(0, 7));
  const [focusedEventId, setFocusedEventId] = useState("");
  const [query, setQuery] = useState("");
  const [editingEvent, setEditingEvent] = useState<ServiceEvent | null>(null);
  const [attendanceEvent, setAttendanceEvent] = useState<ServiceEvent | null>(null);
  const [attendanceAdults, setAttendanceAdults] = useState("0");
  const [attendanceChildren, setAttendanceChildren] = useState("0");
  const [attendanceSaving, setAttendanceSaving] = useState(false);
  const [checkInEvent, setCheckInEvent] = useState<ServiceEvent | null>(null);
  const [checkIns, setCheckIns] = useState<ServiceEventCheckIn[]>([]);
  const [registrations, setRegistrations] = useState<EventRegistration[]>([]);
  const [checkInsLoading, setCheckInsLoading] = useState(false);
  const [checkInQuery, setCheckInQuery] = useState("");
  const [followUpQueueOpen, setFollowUpQueueOpen] = useState(false);
  const [followUps, setFollowUps] = useState<VisitorFollowUp[]>([]);
  const [followUpsLoading, setFollowUpsLoading] = useState(false);
  const [followUpFilter, setFollowUpFilter] = useState<"open" | "all">("open");
  const [followUpSavingId, setFollowUpSavingId] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [room, setRoom] = useState("");
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [positions, setPositions] = useState<ServicePosition[]>([]);
  const [timePlan, setTimePlan] = useState<ServicePlanItem[]>([]);
  const [recurrenceInterval, setRecurrenceInterval] = useState<"" | "weekly" | "biweekly" | "monthly">("");
  const [applyToSeries, setApplyToSeries] = useState(false);

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
  const calendarDays = useMemo(() => {
    const [year, month] = calendarMonth.split("-").map(Number);
    const firstDay = new Date(Date.UTC(year, month - 1, 1));
    const mondayOffset = (firstDay.getUTCDay() + 6) % 7;
    const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const cellCount = Math.ceil((mondayOffset + dayCount) / 7) * 7;
    return Array.from({ length: cellCount }, (_, index) => {
      const date = new Date(Date.UTC(year, month - 1, 1 - mondayOffset + index));
      return { date: date.toISOString().slice(0, 10), inMonth: date.getUTCMonth() === month - 1 };
    });
  }, [calendarMonth]);
  const focusedEvent = events.find((event) => event.id === focusedEventId) ?? null;
  const filteredCheckInContacts = contacts.filter((person) => `${person.firstName} ${person.lastName}`.toLocaleLowerCase().includes(checkInQuery.trim().toLocaleLowerCase()));

  function moveCalendarMonth(amount: number) {
    const [year, month] = calendarMonth.split("-").map(Number);
    setCalendarMonth(new Date(Date.UTC(year, month - 1 + amount, 1)).toISOString().slice(0, 7));
    setFocusedEventId("");
  }

  function openCreateModal() {
    setEditingEvent(null);
    setRecurrenceInterval(""); setApplyToSeries(false);
    setRoom(""); setAssetIds([]); setPositions([{ name: "Tech" }, { name: "Band" }, { name: "Preacher" }, { name: "Moderation" }]); setTimePlan([]);
    setIsModalOpen(true);
  }

  function openEditModal(event: ServiceEvent) {
    setEditingEvent(event);
    setRecurrenceInterval(""); setApplyToSeries(false);
    setRoom(event.room ?? ""); setAssetIds(event.assetIds ?? []); setPositions(event.positions ?? []); setTimePlan(event.timePlan ?? []);
    setIsModalOpen(true);
  }

  async function saveEvent(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = formEvent.currentTarget;
    const payload: CreateServiceEvent = { ...eventPayload(form), room, assetIds, positions: positions.filter((position) => position.name.trim()).map(({ name, contactId }) => ({ name, ...(contactId ? { contactId } : {}) })), timePlan: timePlan.filter((item) => item.title.trim()).map((item) => ({ ...item, durationMinutes: item.durationMinutes ? Number(item.durationMinutes) : undefined })) };
    setIsSaving(true);
    try {
      const updatingSeries = Boolean(editingEvent?.seriesId && applyToSeries);
      const response = await fetch(editingEvent ? `/api/events/${editingEvent.id}${updatingSeries ? "/series" : ""}` : "/api/events", {
        method: editingEvent ? "PUT" : "POST",
        headers: { "content-type": "application/json", "x-department-id": departmentId },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as ServiceEvent | { seriesId: string; events: ServiceEvent[] } | ServiceEvent[] | { error?: string };
      if (!response.ok) throw new Error(!Array.isArray(result) && "error" in result ? result.error ?? "Could not save this event." : "Could not save this event.");
      if (Array.isArray(result)) {
        const updated = new Map(result.map((item) => [item.id, item]));
        setEvents((current) => current.map((item) => { const next = updated.get(item.id); return next ? preservePositionResponses(next, item) : item; }).sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.startTime.localeCompare(b.startTime)));
        onNotice(`Updated ${result.length} gatherings in the recurring series.`);
      } else if ("events" in result) {
        setEvents((current) => [...current, ...result.events].sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.startTime.localeCompare(b.startTime)));
        onNotice(`Added ${result.events.length} recurring gatherings to the schedule.`);
      } else if ("id" in result) {
        setEvents((current) => editingEvent
          ? current.map((item) => item.id === result.id ? preservePositionResponses(result, item) : item)
          : [...current, result].sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.startTime.localeCompare(b.startTime)));
        onNotice(editingEvent ? `${result.title} was updated.` : `${result.title} was added to the schedule.`);
      }
      setIsModalOpen(false);
      setEditingEvent(null);
      form.reset();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not save this event.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteEvent(event: ServiceEvent, wholeSeries = false) {
    const target = wholeSeries ? "the entire recurring series" : "this gathering";
    if (!window.confirm(`Delete ${target} for “${event.title}” from the schedule?`)) return;
    try {
      const response = await fetch(`/api/events/${event.id}${wholeSeries ? "/series" : ""}`, { method: "DELETE", headers: { "x-department-id": departmentId } });
      const result = await response.json() as { error?: string; deleted?: number };
      if (!response.ok) throw new Error(result.error ?? "Could not delete this event.");
      setEvents((current) => current.filter((item) => wholeSeries ? item.seriesId !== event.seriesId : item.id !== event.id));
      onNotice(wholeSeries ? `Removed ${result.deleted ?? 0} gatherings in the recurring series.` : `${event.title} was removed from the schedule.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not delete this event.");
    }
  }

  async function respondToPosition(event: ServiceEvent, positionIndex: number, status: "pending" | "accepted" | "declined") {
    try {
      const response = await fetch(`/api/events/${event.id}/positions/${positionIndex}/response`, { method: "PUT", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify({ status }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not update your response.");
      setEvents((current) => current.map((item) => item.id === event.id ? { ...item, positions: item.positions?.map((position, index) => index === positionIndex ? { ...position, responseStatus: status } : position) } : item));
      onNotice(status === "pending" ? "Your response was cleared." : status === "accepted" ? "You accepted this service position." : "You declined this service position.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Could not update your response."); }
  }

  function openAttendance(event: ServiceEvent) {
    setAttendanceEvent(event);
    setAttendanceAdults(String(event.attendanceAdults ?? 0));
    setAttendanceChildren(String(event.attendanceChildren ?? 0));
  }

  async function saveAttendance(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!attendanceEvent) return;
    setAttendanceSaving(true);
    try {
      const response = await fetch(`/api/events/${attendanceEvent.id}/attendance`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-department-id": departmentId },
        body: JSON.stringify({ adults: Number(attendanceAdults), children: Number(attendanceChildren) }),
      });
      const result = await response.json() as { attendanceAdults?: number; attendanceChildren?: number; attendanceRecordedAt?: string; error?: string };
      if (!response.ok || result.attendanceAdults === undefined || result.attendanceChildren === undefined || !result.attendanceRecordedAt) throw new Error(result.error ?? "Could not save attendance.");
      setEvents((current) => current.map((item) => item.id === attendanceEvent.id ? { ...item, attendanceAdults: result.attendanceAdults, attendanceChildren: result.attendanceChildren, attendanceRecordedAt: result.attendanceRecordedAt } : item));
      onNotice(`Attendance saved for ${attendanceEvent.title}.`);
      setAttendanceEvent(null);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Could not save attendance."); }
    finally { setAttendanceSaving(false); }
  }

  async function openCheckIns(event: ServiceEvent) {
    setCheckInEvent(event);
    setCheckInQuery("");
    setCheckIns([]);
    setRegistrations([]);
    setCheckInsLoading(true);
    try {
      const headers = { "x-department-id": departmentId };
      const [checkInResponse, registrationsResponse] = await Promise.all([
        fetch(`/api/events/${event.id}/check-ins`, { headers }),
        fetch(`/api/events/${event.id}/registrations`, { headers }),
      ]);
      const [checkInResult, registrationResult] = await Promise.all([checkInResponse.json(), registrationsResponse.json()]) as [ServiceEventCheckIn[] | { error?: string }, EventRegistration[] | { error?: string }];
      if (!checkInResponse.ok || !Array.isArray(checkInResult)) throw new Error(!Array.isArray(checkInResult) ? checkInResult.error ?? "Could not load check-ins." : "Could not load check-ins.");
      if (!registrationsResponse.ok || !Array.isArray(registrationResult)) throw new Error(!Array.isArray(registrationResult) ? registrationResult.error ?? "Could not load registrations." : "Could not load registrations.");
      setCheckIns(checkInResult);
      setRegistrations(registrationResult);
    } catch (error) {
      setCheckInEvent(null);
      onNotice(error instanceof Error ? error.message : "Could not load check-ins.");
    } finally { setCheckInsLoading(false); }
  }

  async function setRegistrationCheckedIn(registration: EventRegistration, checkedIn: boolean) {
    if (!checkInEvent) return;
    try {
      const response = await fetch(`/api/events/${checkInEvent.id}/registrations/${registration.id}/check-in`, {
        method: "PUT", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify({ checkedIn }),
      });
      const result = await response.json() as EventRegistration | { error?: string };
      if (!response.ok || !("id" in result)) throw new Error("error" in result ? result.error ?? "Could not update registration check-in." : "Could not update registration check-in.");
      setRegistrations((current) => current.map((item) => item.id === result.id ? result : item));
    } catch (error) { onNotice(error instanceof Error ? error.message : "Could not update registration check-in."); }
  }

  async function copyRegistrationLink(event: ServiceEvent) {
    if (!event.registrationToken) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/register/${event.registrationToken}`);
      onNotice("Registration link copied.");
    } catch { onNotice("Could not copy the registration link. Open the event to copy it from your browser address bar."); }
  }

  async function setPersonCheckedIn(person: Contact, checkedIn: boolean) {
    if (!checkInEvent) return;
    try {
      const existing = checkIns.find((entry) => entry.contactId === person.id);
      const response = await fetch(`/api/events/${checkInEvent.id}/check-ins${checkedIn ? "" : `/${person.id}`}`, {
        method: checkedIn ? "PUT" : "DELETE",
        headers: { ...(checkedIn ? { "content-type": "application/json" } : {}), "x-department-id": departmentId },
        ...(checkedIn ? { body: JSON.stringify({ contactId: person.id, firstTimeVisitor: existing?.firstTimeVisitor ?? false }) } : {}),
      });
      const result = await response.json() as ServiceEventCheckIn | { checkedIn?: false; error?: string };
      if (!response.ok) throw new Error("error" in result ? result.error ?? "Could not update check-in." : "Could not update check-in.");
      setCheckIns((current) => checkedIn
        ? [...current.filter((entry) => entry.contactId !== person.id), result as ServiceEventCheckIn].sort((a, b) => a.checkedInAt.localeCompare(b.checkedInAt))
        : current.filter((entry) => entry.contactId !== person.id));
    } catch (error) { onNotice(error instanceof Error ? error.message : "Could not update check-in."); }
  }

  async function setFirstTimeVisitor(person: Contact, firstTimeVisitor: boolean) {
    if (!checkInEvent) return;
    try {
      const response = await fetch(`/api/events/${checkInEvent.id}/check-ins`, { method: "PUT", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify({ contactId: person.id, firstTimeVisitor }) });
      const result = await response.json() as ServiceEventCheckIn | { error?: string };
      if (!response.ok || !("contactId" in result)) throw new Error("error" in result ? result.error ?? "Could not update visitor status." : "Could not update visitor status.");
      setCheckIns((current) => current.map((entry) => entry.contactId === person.id ? result : entry));
    } catch (error) { onNotice(error instanceof Error ? error.message : "Could not update visitor status."); }
  }

  async function setFollowUpStatus(person: Contact, followUpStatus: ServiceEventCheckIn["followUpStatus"]) {
    if (!checkInEvent) return;
    const checkIn = checkIns.find((entry) => entry.contactId === person.id);
    if (!checkIn) return;
    try {
      const response = await fetch(`/api/events/${checkInEvent.id}/check-ins`, { method: "PUT", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify({ contactId: person.id, firstTimeVisitor: checkIn.firstTimeVisitor, followUpStatus }) });
      const result = await response.json() as ServiceEventCheckIn | { error?: string };
      if (!response.ok || !("contactId" in result)) throw new Error("error" in result ? result.error ?? "Could not update follow-up." : "Could not update follow-up.");
      setCheckIns((current) => current.map((entry) => entry.contactId === person.id ? result : entry));
    } catch (error) { onNotice(error instanceof Error ? error.message : "Could not update follow-up."); }
  }

  async function openVisitorFollowUps() {
    setFollowUpQueueOpen(true);
    setFollowUps([]);
    setFollowUpsLoading(true);
    try {
      const response = await fetch("/api/visitor-follow-ups", { headers: { "x-department-id": departmentId } });
      const result = await response.json() as VisitorFollowUp[] | { error?: string };
      if (!response.ok || !Array.isArray(result)) throw new Error(!Array.isArray(result) ? result.error ?? "Could not load visitor follow-ups." : "Could not load visitor follow-ups.");
      setFollowUps(result);
    } catch (error) {
      setFollowUpQueueOpen(false);
      onNotice(error instanceof Error ? error.message : "Could not load visitor follow-ups.");
    } finally { setFollowUpsLoading(false); }
  }

  async function saveVisitorFollowUp(event: FormEvent<HTMLFormElement>, followUp: VisitorFollowUp) {
    event.preventDefault();
    setFollowUpSavingId(`${followUp.eventId}:${followUp.contactId}`);
    try {
      const response = await fetch(`/api/events/${followUp.eventId}/check-ins/${followUp.contactId}/follow-up`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-department-id": departmentId },
        body: JSON.stringify({ status: followUp.status, assignedContactId: followUp.assignedContactId || null, dueDate: followUp.dueDate || null, note: followUp.note }),
      });
      const result = await response.json() as { saved?: boolean; error?: string };
      if (!response.ok || !result.saved) throw new Error(result.error ?? "Could not save visitor follow-up.");
      onNotice(`Follow-up for ${followUp.firstName} ${followUp.lastName} was saved.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Could not save visitor follow-up."); }
    finally { setFollowUpSavingId(""); }
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
        {canManage && <div className="event-heading-actions"><button className="button button-secondary" type="button" onClick={() => void openVisitorFollowUps()}><ClipboardList size={17} /> Visitor follow-ups</button><button className="button button-primary" type="button" onClick={openCreateModal}><Plus size={18} /> Add event</button></div>}
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
          <div className="schedule-view-toggle" role="group" aria-label="Schedule view">
            <button className={scheduleView === "list" ? "is-active" : ""} type="button" aria-pressed={scheduleView === "list"} onClick={() => setScheduleView("list")}>List</button>
            <button className={scheduleView === "month" ? "is-active" : ""} type="button" aria-pressed={scheduleView === "month"} onClick={() => setScheduleView("month")}>Month</button>
          </div>
        </div>

        {scheduleView === "month" ? <div className="schedule-calendar" aria-label="Monthly church calendar">
          <div className="schedule-calendar-toolbar"><div><strong>{new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${calendarMonth}-01T12:00:00Z`))}</strong><span>{filteredEvents.filter((event) => event.eventDate.startsWith(calendarMonth)).length} gatherings</span></div><div><button className="community-row-action" type="button" aria-label="Previous month" onClick={() => moveCalendarMonth(-1)}><ArrowLeft size={16} /></button><button className="button button-secondary" type="button" onClick={() => { setCalendarMonth(today.slice(0, 7)); setFocusedEventId(""); }}>Today</button><button className="community-row-action" type="button" aria-label="Next month" onClick={() => moveCalendarMonth(1)}><ArrowRight size={16} /></button></div></div>
          <div className="schedule-calendar-grid" role="grid" aria-label="Calendar dates"><div className="schedule-calendar-weekdays" role="row">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span role="columnheader" key={day}>{day}</span>)}</div><div className="schedule-calendar-days">{calendarDays.map((day) => {
            const dayEvents = filteredEvents.filter((event) => event.eventDate === day.date);
            return <article className={`schedule-calendar-day${day.inMonth ? "" : " is-outside"}${day.date === today ? " is-today" : ""}`} role="gridcell" key={day.date}><time dateTime={day.date}>{Number(day.date.slice(-2))}</time>{dayEvents.map((event) => <button className={`schedule-calendar-event event-kind-${event.kind}`} type="button" key={event.id} onClick={() => setFocusedEventId(event.id)} title={`${event.startTime} · ${event.title}`}>{event.startTime} {event.title}</button>)}</article>;
          })}</div></div>
          {focusedEvent && <article className="schedule-calendar-detail"><div><span className={`event-kind event-kind-${focusedEvent.kind}`}>{eventKindLabel(focusedEvent.kind)}</span><h3>{focusedEvent.title}</h3><p>{formatEventDate(focusedEvent.eventDate)} · {focusedEvent.startTime}{focusedEvent.endTime ? `–${focusedEvent.endTime}` : ""} · {focusedEvent.location}{focusedEvent.room ? ` · ${focusedEvent.room}` : ""}</p>{focusedEvent.description && <p>{focusedEvent.description}</p>}</div>{canManage && !focusedEvent.importedFrom && <button className="button button-secondary" type="button" onClick={() => openEditModal(focusedEvent)}><Pencil size={14} />Edit</button>}</article>}
          {filteredEvents.filter((event) => event.eventDate.startsWith(calendarMonth)).length === 0 && <p className="empty-state schedule-calendar-empty">No gatherings match this month and filter.</p>}
        </div> : <div className="table-scroll"><table className="people-table event-table"><thead><tr><th>DATE</th><th>GATHERING</th><th>TIME</th><th>LOCATION</th><th>TYPE</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
          {filteredEvents.map((event) => {
            const date = formatShortDate(event.eventDate);
            return <tr key={event.id}><td><div className="event-date-badge"><strong>{date.day}</strong><span>{date.month}</span></div></td><td><div className="event-name-cell"><strong>{event.title}</strong>{event.seriesId && <small className="event-series-badge"><Repeat2 size={11} />Recurring series</small>}{event.importedFrom === "churchtools" && <small>ChurchTools · read-only</small>}{event.description && <small>{event.description}</small>}<small className="event-attendance-summary">{event.attendanceRecordedAt ? `Attendance: ${event.attendanceAdults ?? 0} adults · ${event.attendanceChildren ?? 0} children` : "Attendance not recorded"}</small>{event.registrationEnabled && <small className="event-registration-summary">Registration: {event.registrationCount ?? 0}{event.registrationCapacity ? ` / ${event.registrationCapacity}` : " registered"}{event.registrationCapacity && (event.registrationCount ?? 0) >= event.registrationCapacity ? " · waitlist open" : ""}</small>}{Boolean(event.positions?.length) && <div className="event-position-list">{event.positions!.map((position, index) => { const person = contacts.find((contact) => contact.id === position.contactId); const responseLabel = position.responseStatus === "accepted" ? "Accepted" : position.responseStatus === "declined" ? "Declined" : position.contactId ? "Awaiting response" : "Unassigned"; return <div className="event-position-row" key={index}><small>{position.name}: {person ? `${person.firstName} ${person.lastName}` : "Unassigned"} · {responseLabel}</small>{position.canRespond && <select aria-label={`Response for ${position.name}`} value={position.responseStatus ?? "pending"} onChange={(change) => void respondToPosition(event, index, change.target.value as "pending" | "accepted" | "declined")}><option value="pending">Choose response</option><option value="accepted">Accept</option><option value="declined">Decline</option></select>}</div>; })}</div>}{Boolean(event.timePlan?.length) && <small>Time plan: {event.timePlan!.map((item) => (item.startTime ? item.startTime + " " : "") + item.title + (item.durationMinutes ? " (" + item.durationMinutes + " min)" : "")).join(" → ")}</small>}{Boolean(event.assetIds?.length) && <small>Assets: {resources.filter((resource) => event.assetIds!.includes(resource.id)).map((resource) => resource.name).join(", ")}</small>}</div></td><td className="event-time-cell">{event.startTime}{event.endTime ? ` – ${event.endTime}` : ""}</td><td><span className="event-location-cell"><MapPin size={13} />{event.location}{event.room ? " · " + event.room : ""}</span></td><td><span className={`event-kind event-kind-${event.kind}`}>{eventKindLabel(event.kind)}</span></td><td>{canManage && !event.importedFrom && <div className="event-actions">{event.registrationEnabled && <button className="event-action" type="button" aria-label={`Copy registration link for ${event.title}`} title="Copy registration link" onClick={() => void copyRegistrationLink(event)}><Link2 size={15} /></button>}<button className="event-action" type="button" aria-label={`Check in people for ${event.title}`} title="Check in people" onClick={() => void openCheckIns(event)}><UserCheck size={15} /></button><button className="event-action" type="button" aria-label={`Record attendance for ${event.title}`} title="Record attendance headcount" onClick={() => openAttendance(event)}><Users size={15} /></button><button className="event-action" type="button" aria-label={`Edit ${event.title}`} onClick={() => openEditModal(event)}><Pencil size={15} /></button><button className="event-action event-delete-action" type="button" aria-label={`Delete ${event.title}`} onClick={() => void deleteEvent(event)}><Trash2 size={15} /></button>{event.seriesId && <button className="event-action event-series-delete" type="button" aria-label={`Delete recurring series for ${event.title}`} title="Delete recurring series" onClick={() => void deleteEvent(event, true)}><Repeat2 size={15} /></button>}</div>}</td></tr>;
          })}
          {filteredEvents.length === 0 && <tr><td colSpan={6} className="empty-state">{isLoading ? "Loading the schedule…" : loadError ? "The schedule could not be loaded." : query ? "No gatherings match your search." : filter === "past" ? "There are no past gatherings yet." : "No gatherings scheduled. Add your first service or event."}</td></tr>}
        </tbody></table></div>}
        <footer className="table-footer"><span>Showing <strong>{filteredEvents.length}</strong> of <strong>{events.length}</strong> gatherings</span><span className="event-footer-note">Times use {departmentTimeZone}.</span></footer>
      </section>

      <footer className="page-footer"><span>Make room for what brings us together.</span><span>© 2026 Smart Church</span></footer>

      {isModalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setIsModalOpen(false)}><section className="modal event-modal" role="dialog" aria-modal="true" aria-labelledby="event-modal-title"><div className="modal-heading"><div><span className="eyebrow">CHURCH SCHEDULE</span><h2 id="event-modal-title">{editingEvent ? "Edit gathering" : "Add a gathering"}</h2><p>Share the details so everyone knows when and where to meet.</p></div><button className="icon-button" type="button" aria-label="Close dialog" onClick={() => setIsModalOpen(false)}><X size={19} /></button></div><form key={editingEvent?.id ?? "new-event"} onSubmit={saveEvent}>
        <label>Title<input name="title" autoFocus required maxLength={160} defaultValue={editingEvent?.title ?? ""} placeholder="Sunday worship service" /></label>
        <div className="form-row"><label>Type<select name="kind" defaultValue={editingEvent?.kind ?? "service"}>{eventKinds.map((kind) => <option value={kind.value} key={kind.value}>{kind.label}</option>)}</select></label><label>Location / building<input name="location" required maxLength={160} defaultValue={editingEvent?.location ?? departmentLocation} placeholder="Church building" /></label><label>Room<input maxLength={160} value={room} onChange={(event) => setRoom(event.target.value)} placeholder="Main hall" /></label></div>
        <div className="form-row event-time-row"><label>Date<input type="date" name="eventDate" required defaultValue={editingEvent?.eventDate ?? departmentDateString(departmentTimeZone)} /></label><label>Starts at<input type="time" name="startTime" required defaultValue={editingEvent?.startTime ?? "10:00"} /></label><label>Ends at <span className="optional-label">Optional</span><input type="time" name="endTime" defaultValue={editingEvent?.endTime ?? ""} /></label></div>
        <label>Description <span className="optional-label">Optional</span><textarea name="description" maxLength={2000} rows={3} defaultValue={editingEvent?.description ?? ""} placeholder="A few helpful details for the community" /></label>
        <section className="service-planning-section event-registration-settings"><div className="service-planning-heading"><div><h3>Public registration</h3><p>Let guests register from a shareable link. Full events use a waitlist.</p></div></div><label className="event-registration-toggle"><input type="checkbox" name="registrationEnabled" defaultChecked={editingEvent?.registrationEnabled ?? false} /><span>Allow people to register for this event</span></label><label>Capacity <span className="optional-label">Optional · leave empty for unlimited</span><input type="number" name="registrationCapacity" min="1" max="100000" step="1" defaultValue={editingEvent?.registrationCapacity ?? ""} placeholder="No limit" /></label>{editingEvent?.registrationToken && <p className="event-registration-existing-link">Current link: <code>{window.location.origin}/register/{editingEvent.registrationToken}</code></p>}</section>
        {!editingEvent && <section className="event-recurrence-controls"><label>Repeat<select name="recurrence" value={recurrenceInterval} onChange={(event) => setRecurrenceInterval(event.target.value as typeof recurrenceInterval)}><option value="">Does not repeat</option><option value="weekly">Every week</option><option value="biweekly">Every 2 weeks</option><option value="monthly">Every month</option></select></label>{recurrenceInterval && <label>Repeat until<input type="date" name="recurrenceEndDate" required min={departmentDateString(departmentTimeZone)} defaultValue={new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)} /></label>}<p>Creates separate gatherings through the selected end date, up to one year ahead.</p></section>}
        {editingEvent?.seriesId && <label className="event-series-update"><input type="checkbox" checked={applyToSeries} onChange={(event) => setApplyToSeries(event.target.checked)} /><span>Apply these changes to all {events.filter((item) => item.seriesId === editingEvent.seriesId).length} gatherings in this series</span></label>}
        <section className="service-planning-section"><div className="service-planning-heading"><div><h3>Assets</h3><p>Rooms and equipment already listed in Resources.</p></div></div>{resources.length ? <div className="service-asset-list">{resources.map((resource) => <label key={resource.id}><input type="checkbox" checked={assetIds.includes(resource.id)} onChange={(event) => setAssetIds((current) => event.target.checked ? [...current, resource.id] : current.filter((id) => id !== resource.id))} /><span>{resource.name}<small>{resource.category}{resource.location ? " · " + resource.location : ""}</small></span></label>)}</div> : <p className="service-planning-empty">Add rooms or equipment in Resources to attach them here.</p>}</section>
        <section className="service-planning-section"><div className="service-planning-heading"><div><h3>Positions</h3><p>Assign tech, band, preacher, moderation, and other roles.</p></div><button className="button button-secondary" type="button" onClick={() => setPositions((current) => [...current, { name: "" }])}><Plus size={14} />Add position</button></div>{positions.length ? <div className="service-position-list">{positions.map((position, index) => <div className="service-position-row" key={index}><input aria-label="Position name" required placeholder="e.g. Preacher" value={position.name} onChange={(event) => setPositions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /><select aria-label="Assigned person" value={position.contactId ?? ""} onChange={(event) => setPositions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, contactId: event.target.value || undefined } : item))}><option value="">Unassigned</option>{contacts.map((person) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>)}</select><button className="community-row-action community-row-delete" type="button" aria-label="Remove position" onClick={() => setPositions((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button></div>)}</div> : <p className="service-planning-empty">Add the people and roles needed for this service.</p>}</section>
        <section className="service-planning-section"><div className="service-planning-heading"><div><h3>Time plan</h3><p>Arrange service moments in the order they will happen.</p></div><button className="button button-secondary" type="button" onClick={() => setTimePlan((current) => [...current, { title: "" }])}><Plus size={14} />Add item</button></div>{timePlan.length ? <div className="service-timeplan-list">{timePlan.map((item, index) => <div className="service-timeplan-row" key={index}><input aria-label="Time plan item" required placeholder="e.g. Welcome and opening song" value={item.title} onChange={(event) => setTimePlan((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, title: event.target.value } : entry))} /><input aria-label="Start time" type="time" value={item.startTime ?? ""} onChange={(event) => setTimePlan((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, startTime: event.target.value || undefined } : entry))} /><input aria-label="Duration in minutes" type="number" min="1" max="1440" placeholder="Minutes" value={item.durationMinutes ?? ""} onChange={(event) => setTimePlan((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, durationMinutes: event.target.value ? Number(event.target.value) : undefined } : entry))} /><div className="service-timeplan-order"><button className="community-row-action" type="button" aria-label="Move item up" disabled={index === 0} onClick={() => setTimePlan((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}><ArrowUp size={14} /></button><button className="community-row-action" type="button" aria-label="Move item down" disabled={index === timePlan.length - 1} onClick={() => setTimePlan((current) => { const next = [...current]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next; })}><ArrowDown size={14} /></button><button className="community-row-action community-row-delete" type="button" aria-label="Remove time plan item" onClick={() => setTimePlan((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></button></div><input className="service-timeplan-notes" aria-label="Time plan notes" placeholder="Notes (optional)" value={item.notes ?? ""} onChange={(event) => setTimePlan((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, notes: event.target.value } : entry))} /></div>)}</div> : <p className="service-planning-empty">Build an ordered plan for the service.</p>}</section>
        <div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setIsModalOpen(false)}>Cancel</button><button className="button button-primary" type="submit" disabled={isSaving}><Check size={16} /> {isSaving ? "Saving…" : editingEvent ? "Save changes" : "Add to schedule"}</button></div>
      </form></section></div>}
      {attendanceEvent && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setAttendanceEvent(null)}><section className="modal attendance-modal" role="dialog" aria-modal="true" aria-labelledby="attendance-modal-title"><div className="modal-heading"><div><span className="eyebrow">SERVICE RECORD</span><h2 id="attendance-modal-title">Record attendance</h2><p>{attendanceEvent.title} · {formatEventDate(attendanceEvent.eventDate)}</p></div><button className="icon-button" type="button" aria-label="Close dialog" onClick={() => setAttendanceEvent(null)}><X size={19} /></button></div><form onSubmit={(event) => void saveAttendance(event)}><div className="form-row"><label>Adults<input type="number" min="0" max="100000" step="1" required value={attendanceAdults} onChange={(event) => setAttendanceAdults(event.target.value)} /></label><label>Children<input type="number" min="0" max="100000" step="1" required value={attendanceChildren} onChange={(event) => setAttendanceChildren(event.target.value)} /></label></div><p className="service-planning-empty">Enter the number of adults and children who attended.</p><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setAttendanceEvent(null)}>Cancel</button><button className="button button-primary" type="submit" disabled={attendanceSaving}><Check size={16} />{attendanceSaving ? "Saving…" : "Save attendance"}</button></div></form></section></div>}
      {checkInEvent && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setCheckInEvent(null)}><section className="modal check-in-modal" role="dialog" aria-modal="true" aria-labelledby="check-in-modal-title"><div className="modal-heading"><div><span className="eyebrow">SERVICE CHECK-IN</span><h2 id="check-in-modal-title">Check in people</h2><p>{checkInEvent.title} · {formatEventDate(checkInEvent.eventDate)}</p></div><button className="icon-button" type="button" aria-label="Close dialog" onClick={() => setCheckInEvent(null)}><X size={19} /></button></div><div className="check-in-summary"><strong>{checkIns.length} checked in</strong><span>{checkIns.filter((entry) => entry.firstTimeVisitor).length} first-time visitors</span><span>{checkIns.filter((entry) => entry.followUpStatus === "needed").length} follow-ups needed</span></div><section className="event-registration-roster"><div className="service-planning-heading"><div><h3>Event registrations</h3><p>Registered guests can be checked in here. Waitlisted guests are marked below.</p></div></div>{registrations.length ? <div className="check-in-list">{registrations.map((registration) => <div className="check-in-row" key={registration.id}><label className="check-in-person"><input type="checkbox" checked={Boolean(registration.checkedInAt)} disabled={registration.status === "waitlisted"} onChange={(change) => void setRegistrationCheckedIn(registration, change.target.checked)} /><span><strong>{registration.firstName} {registration.lastName}</strong><small>{registration.email} · {registration.status === "waitlisted" ? "Waitlisted" : "Registered"}</small></span></label>{registration.checkedInAt && <span className="event-registration-checked">Checked in</span>}</div>)}</div> : <p className="community-empty">No public registrations yet.</p>}</section><label className="search-field check-in-search"><Search size={16} /><input aria-label="Search people to check in" placeholder="Find someone in the directory…" value={checkInQuery} onChange={(event) => setCheckInQuery(event.target.value)} /></label>{checkInsLoading ? <p className="community-empty">Loading check-ins…</p> : filteredCheckInContacts.length ? <div className="check-in-list">{filteredCheckInContacts.map((person) => { const checkIn = checkIns.find((entry) => entry.contactId === person.id); return <div className="check-in-row" key={person.id}><label className="check-in-person"><input type="checkbox" checked={Boolean(checkIn)} onChange={(event) => void setPersonCheckedIn(person, event.target.checked)} /><span><strong>{person.firstName} {person.lastName}</strong><small>{person.status === "visitor" ? "Visitor" : "Member"}</small></span></label>{checkIn && <div className="check-in-controls"><label className="check-in-first-visit"><input type="checkbox" checked={checkIn.firstTimeVisitor} onChange={(event) => void setFirstTimeVisitor(person, event.target.checked)} /><span>First time</span></label>{checkIn.firstTimeVisitor && <select aria-label={`Follow-up status for ${person.firstName} ${person.lastName}`} value={checkIn.followUpStatus} onChange={(event) => void setFollowUpStatus(person, event.target.value as ServiceEventCheckIn["followUpStatus"])}><option value="needed">Follow-up needed</option><option value="done">Follow-up complete</option><option value="not_needed">No follow-up</option></select>}</div>}</div>; })}</div> : <p className="community-empty">No people match your search.</p>}<div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setCheckInEvent(null)}>Close</button></div></section></div>}
      {followUpQueueOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setFollowUpQueueOpen(false)}><section className="modal follow-up-modal" role="dialog" aria-modal="true" aria-labelledby="follow-up-modal-title"><div className="modal-heading"><div><span className="eyebrow">PASTORAL CARE</span><h2 id="follow-up-modal-title">Visitor follow-ups</h2><p>Assign a person to connect with first-time visitors and track the next step.</p></div><button className="icon-button" type="button" aria-label="Close dialog" onClick={() => setFollowUpQueueOpen(false)}><X size={19} /></button></div><div className="filter-tabs" role="tablist" aria-label="Filter visitor follow-ups"><button className={followUpFilter === "open" ? "filter-tab filter-tab-active" : "filter-tab"} type="button" role="tab" aria-selected={followUpFilter === "open"} onClick={() => setFollowUpFilter("open")}>Open <span>{followUps.filter((item) => item.status === "needed").length}</span></button><button className={followUpFilter === "all" ? "filter-tab filter-tab-active" : "filter-tab"} type="button" role="tab" aria-selected={followUpFilter === "all"} onClick={() => setFollowUpFilter("all")}>All <span>{followUps.length}</span></button></div>{followUpsLoading ? <p className="community-empty">Loading follow-ups…</p> : followUps.filter((item) => followUpFilter === "all" || item.status === "needed").length ? <div className="follow-up-list">{followUps.filter((item) => followUpFilter === "all" || item.status === "needed").map((item) => { const rowId = `${item.eventId}:${item.contactId}`; return <form className="follow-up-item" key={rowId} onSubmit={(event) => void saveVisitorFollowUp(event, item)}><div className="follow-up-item-heading"><div><strong>{item.firstName} {item.lastName}</strong><small>First visit · {formatEventDate(item.eventDate)} · {item.eventTitle}</small></div><select aria-label={`Follow-up status for ${item.firstName} ${item.lastName}`} value={item.status} onChange={(event) => setFollowUps((current) => current.map((entry) => `${entry.eventId}:${entry.contactId}` === rowId ? { ...entry, status: event.target.value as VisitorFollowUp["status"] } : entry))}><option value="needed">Open</option><option value="done">Completed</option><option value="not_needed">No follow-up</option></select></div><div className="form-row follow-up-fields"><label>Assigned to<select value={item.assignedContactId ?? ""} onChange={(event) => setFollowUps((current) => current.map((entry) => `${entry.eventId}:${entry.contactId}` === rowId ? { ...entry, assignedContactId: event.target.value || undefined } : entry))}><option value="">Unassigned</option>{contacts.filter((person) => person.status === "member").map((person) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>)}</select></label><label>Due date<input type="date" value={item.dueDate ?? ""} onChange={(event) => setFollowUps((current) => current.map((entry) => `${entry.eventId}:${entry.contactId}` === rowId ? { ...entry, dueDate: event.target.value || undefined } : entry))} /></label></div><label>Follow-up note<textarea rows={2} maxLength={1000} value={item.note} onChange={(event) => setFollowUps((current) => current.map((entry) => `${entry.eventId}:${entry.contactId}` === rowId ? { ...entry, note: event.target.value } : entry))} placeholder="Optional note for the person following up" /></label><div className="follow-up-actions"><button className="button button-secondary" type="submit" disabled={followUpSavingId === rowId}><Check size={15} />{followUpSavingId === rowId ? "Saving…" : "Save follow-up"}</button></div></form>; })}</div> : <p className="community-empty">{followUpFilter === "open" ? "No visitor follow-ups are waiting." : "No first-time visitor follow-ups have been recorded."}</p>}<div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setFollowUpQueueOpen(false)}>Close</button></div></section></div>}
    </>
  );
}
