import { ResourceAvailabilityCheck } from "./ResourceAvailabilityCheck";
import { MyResourceBookings } from "./MyResourceBookings";
import { ResourceBookedDays } from "./ResourceBookedDays";
import { zonedInputToUtc } from "./zoned-input";
import { AuditList, BookingAuditDialog, type BookingAuditEntry } from "./BookingAuditDialog";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, History, Pencil, Plus, Printer, Settings2, Star, X } from "lucide-react";
import "./resource-scheduler.css";

type Resource = { id: string; name: string; category: string; location: string; active: boolean; marked: boolean; matchesSearch: boolean; requires_approval: boolean; calendarRequired?: boolean; managerBookingOnly?: boolean; visibilityGroupId?: string | null; responsibleUserId?: string | null; totalUnits: number; defaultLeadInMinutes: number; defaultCleanupMinutes: number };
type Booking = { id: string; resourceId: string; resourceName: string; location: string; requestedBy: string; requesterName: string; purpose: string; startsAt: string; endsAt: string; occurrenceDate: string | null; timeZone: string | null; status: "requested" | "approved" | "declined" | "cancelled"; quantity: number; leadInMinutes: number; cleanupMinutes: number; seriesId: string | null; recurrence: { frequency: string; interval?: number; endsOn?: string; count?: number; weekdays?: number[] } | null; isExtraDate: boolean; hasOccurrenceOverride: boolean; hasLinkedAppointment: boolean; canCancel: boolean; canEditSeries: boolean };
type Appointment = { appointmentId: string; title: string; occurrenceStartAt: string; calendarName: string };
type Bootstrap = { resources: Resource[]; bookings: Booking[]; canManage: boolean; responsiblePeople?: { id: string; displayName: string }[]; visibilityGroups?: { id: string; name: string }[]; timeZone: string; from: string; to: string };
type FutureEditForm = { seriesId: string; timeZone: string | null; fromDate: string; purpose: string; startsAt: string; endsAt: string; quantity: number; leadInMinutes: number; cleanupMinutes: number; frequency: string; interval: number; endsOn: string };
type FutureEditPreview = { fromDate: string; occurrenceCount: number; addedCount: number; updatedCount: number; cancelledCount: number; approvedCount: number; blocked: boolean; calendarRequired?: boolean; managerRequired?: boolean; visibilityRequired?: boolean };
type OccurrenceEdit = { seriesId: string; timeZone: string | null; date: string; startsAt: string; endsAt: string; quantity: number; hasOverride: boolean };
type ExtraDate = { date: string; bookingId: string | null; status: Booking["status"] | null; startsAt: string | null; endsAt: string | null };

function addDays(value: string, count: number) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + count); return date.toISOString().slice(0, 10); }
function monday(value: string) { const day = new Date(`${value}T12:00:00Z`).getUTCDay(); return addDays(value, -((day + 6) % 7)); }
function localInput(date: Date) { return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
function localInputInZone(date: Date, timeZone: string | null) {
  if (!timeZone) return localInput(date);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(date);
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}`;
}
function formatTime(value: string, timeZone?: string | null) { return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", ...(timeZone ? { timeZone } : {}) }).format(new Date(value)); }
function formatDay(value: string) { return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)); }
const statusLabels: Record<Booking["status"], string> = { requested: "Pending", approved: "Confirmed", declined: "Rejected", cancelled: "Cancelled" };

export function ResourceSchedulerModule({ departmentId, csrfToken, canManage }: { departmentId: string; csrfToken: string; canManage: boolean }) {
  const [week, setWeek] = useState(() => monday(new Date().toISOString().slice(0, 10)));
  const [showMyBookings, setShowMyBookings] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [resourceFilter, setResourceFilter] = useState("all");
  const [markedOnly, setMarkedOnly] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const search = searchInput.trim();
  const [marking, setMarking] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [data, setData] = useState<Bootstrap>({ resources: [], bookings: [], canManage: false, timeZone: "UTC", from: "", to: "" });
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showRequest, setShowRequest] = useState(false);
  const [showBookedDays, setShowBookedDays] = useState(false);
  const [bookedDaysRevision, setBookedDaysRevision] = useState(0);
  const [loadedDepartment, setLoadedDepartment] = useState("");
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [dateAction, setDateAction] = useState<{ seriesId: string; action: "extra" | "exclude" } | null>(null);
  const [dateValue, setDateValue] = useState("");
  const [auditDialog, setAuditDialog] = useState<{ departmentId: string; entries: BookingAuditEntry[] } | null>(null);
  const [bookingHistory, setBookingHistory] = useState<{ departmentId: string; bookingId: string; title: string } | null>(null);
  const [futureEdit, setFutureEdit] = useState<FutureEditForm | null>(null);
  const [futurePreview, setFuturePreview] = useState<FutureEditPreview | null>(null);
  const [extraDatesDialog, setExtraDatesDialog] = useState<{ seriesId: string; rows: ExtraDate[] } | null>(null);
  const [occurrenceEdit, setOccurrenceEdit] = useState<OccurrenceEdit | null>(null);
  const timeZoneInitialized = useRef(false);
  const matrixRef = useRef<HTMLElement>(null);
  const [loadedScope, setLoadedScope] = useState("");
  const [form, setForm] = useState({ resourceId: "", purpose: "", startsAt: localInput(new Date(Date.now() + 86_400_000)), endsAt: localInput(new Date(Date.now() + 86_400_000 + 3_600_000)), quantity: 1, recurrence: "once", interval: 1, endsOn: "", leadInMinutes: 0, cleanupMinutes: 0, extraDates: "", excludedDates: "", linkedAppointmentId: "" });

  const scope = JSON.stringify([departmentId, week, resourceFilter, statusFilter, markedOnly, search, refreshVersion]);
  const from = week;
  const to = addDays(week, 6);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(week, index)), [week]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError("");
    try {
      const query = new URLSearchParams({ from, to, status: statusFilter, markedOnly: String(markedOnly), search, ...(resourceFilter !== "all" ? { resourceId: resourceFilter } : {}) });
      const response = await fetch(`/api/modules/resource-scheduler/bootstrap?${query}`, { headers: { "x-department-id": departmentId }, signal });
      const result = await response.json() as Bootstrap | { error?: string };
      if (!response.ok || !("resources" in result)) throw new Error("error" in result ? result.error ?? "Could not load resource schedule." : "Could not load resource schedule.");
      if (signal?.aborted) return;
      setData(result);
      setLoadedDepartment(departmentId);
      setLoadedScope(scope);
      if (!timeZoneInitialized.current) {
        timeZoneInitialized.current = true;
        const startsAt = new Date(Date.now() + 86_400_000);
        setWeek(monday(localInputInZone(new Date(), result.timeZone).slice(0, 10)));
        setForm((current) => ({ ...current, startsAt: localInputInZone(startsAt, result.timeZone), endsAt: localInputInZone(new Date(startsAt.getTime() + 3_600_000), result.timeZone) }));
      }
    } catch (reason) { if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "Could not load resource schedule."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [departmentId, from, markedOnly, resourceFilter, scope, search, statusFilter, to]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => void load(controller.signal), search ? 180 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load, search]);

  useEffect(() => {
    const request = async () => {
      try {
        const range = new URLSearchParams({ from: `${from}T00:00`, to: `${to}T23:59` });
        const response = await fetch(`/api/modules/church-calendar/appointments?${range}`, { headers: { "x-department-id": departmentId } });
        if (!response.ok) return;
        const records = await response.json() as Appointment[];
        setAppointments(records);
      } catch { setAppointments([]); }
    };
    void request();
  }, [departmentId, from, to]);

  async function mutate(path: string, method: string, body?: unknown) {
    const response = await fetch(path, { method, headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error ?? "The request could not be completed.");
    setBookedDaysRevision((version) => version + 1);
  }

  async function toggleResourceMark(resource: Resource) {
    setMarking(true);
    setError("");
    try {
      await mutate(`/api/modules/resource-scheduler/resources/${resource.id}/mark`, "PUT", { marked: !resource.marked });
      setRefreshVersion((version) => version + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the resource mark.");
    } finally {
      setMarking(false);
    }
  }

  function startRequest() {
    const bookable = data.resources.filter((item) => item.active && !item.calendarRequired && (!item.managerBookingOnly || canManage));
    const resource = bookable.find((item) => item.id === form.resourceId) ?? bookable[0];
    if (!resource) { setError("Select an active resource that accepts direct requests. Calendar-required resources can be booked from a saved Calendar appointment."); return; }
    setForm((current) => ({ ...current, resourceId: resource.id, leadInMinutes: resource.defaultLeadInMinutes, cleanupMinutes: resource.defaultCleanupMinutes }));
    setShowRequest(true);
    setNotice(""); setError("");
  }

  const previewResource = data.resources.find((resource) => resource.id === form.resourceId);

  async function createSeries(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(""); setNotice("");
    const parseDates = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
    try {
      const repeat: Record<string, unknown> = { frequency: form.recurrence, interval: Number(form.interval) || 1 };
      if (form.endsOn && form.recurrence !== "once") repeat.endsOn = form.endsOn;
      await mutate("/api/modules/resource-scheduler/series", "POST", {
        resourceId: form.resourceId, purpose: form.purpose.trim(), startsAt: zonedInputToUtc(form.startsAt, data.timeZone), endsAt: zonedInputToUtc(form.endsAt, data.timeZone),
        quantity: Number(form.quantity), leadInMinutes: Number(form.leadInMinutes), cleanupMinutes: Number(form.cleanupMinutes), recurrence: repeat,
        extraDates: parseDates(form.extraDates), excludedDates: parseDates(form.excludedDates), linkedAppointmentId: form.linkedAppointmentId || null,
      });
      setShowRequest(false); setNotice("Booking request saved. Check the status in the schedule."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the booking."); }
    finally { setSaving(false); }
  }

  async function changeStatus(booking: Booking, status: "approved" | "declined" | "cancelled") {
    try { await mutate(`/api/modules/resource-scheduler/bookings/${booking.id}/status`, "PUT", { status }); setNotice(`Booking ${statusLabels[status].toLocaleLowerCase()}.`); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update booking status."); }
  }

  async function saveResourceSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editingResource) return;
    const formData = new FormData(event.currentTarget);
    try {
      await mutate(`/api/modules/resource-scheduler/resources/${editingResource.id}/settings`, "PUT", { totalUnits: Number(formData.get("totalUnits")), defaultLeadInMinutes: Number(formData.get("defaultLeadInMinutes")), defaultCleanupMinutes: Number(formData.get("defaultCleanupMinutes")), calendarRequired: formData.get("calendarRequired") === "on", managerBookingOnly: formData.get("managerBookingOnly") === "on", responsibleUserId: formData.get("responsibleUserId") || null, visibilityGroupId: formData.get("visibilityGroupId") || null });
      setEditingResource(null); setNotice("Resource availability settings saved."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update resource availability."); }
  }

  async function submitDateAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!dateAction || !dateValue) return;
    const path = `/api/modules/resource-scheduler/series/${dateAction.seriesId}/${dateAction.action === "extra" ? "extra-dates" : "exceptions"}`;
    try { await mutate(path, "POST", { date: dateValue }); setDateAction(null); setDateValue(""); setNotice(dateAction.action === "extra" ? "Extra booking date added." : "Occurrence cancelled."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update the recurring booking."); }
  }

  async function archiveSeries(seriesId: string) {
    if (!window.confirm("Cancel all future occurrences in this series? Existing history will remain.")) return;
    try { await mutate(`/api/modules/resource-scheduler/series/${seriesId}/archive`, "POST", {}); setNotice("Booking series cancelled."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not cancel the series."); }
  }

  async function openSeriesHistory(seriesId: string) {
    try {
      const response = await fetch(`/api/modules/resource-scheduler/series/${seriesId}/audit`, { headers: { "x-department-id": departmentId } });
      const result = await response.json() as BookingAuditEntry[] | { error?: string };
      if (!response.ok || !Array.isArray(result)) throw new Error("error" in result ? result.error ?? "Could not load booking history." : "Could not load booking history.");
      setAuditDialog({ departmentId, entries: result });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load booking history."); }
  }

  async function openExtraDates(seriesId: string) {
    try {
      const response = await fetch(`/api/modules/resource-scheduler/series/${seriesId}/extra-dates`, { headers: { "x-department-id": departmentId } });
      const result = await response.json() as ExtraDate[] | { error?: string };
      if (!response.ok || !Array.isArray(result)) throw new Error(!Array.isArray(result) ? result.error ?? "Could not load extra booking dates." : "Could not load extra booking dates.");
      setExtraDatesDialog({ seriesId, rows: result });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load extra booking dates."); }
  }

  async function removeExtraDate(date: ExtraDate) {
    if (!extraDatesDialog) return;
    if (!window.confirm(`Remove the extra booking date ${date.date}?`)) return;
    try {
      await mutate(`/api/modules/resource-scheduler/series/${extraDatesDialog.seriesId}/extra-dates/${date.date}`, "DELETE");
      setNotice("Extra booking date removed.");
      await load();
      await openExtraDates(extraDatesDialog.seriesId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not remove this extra booking date."); }
  }

  function openOccurrenceEdit(booking: Booking) {
    if (!booking.seriesId) return;
    setOccurrenceEdit({ seriesId: booking.seriesId, timeZone: booking.timeZone, date: booking.occurrenceDate ?? booking.startsAt.slice(0, 10), startsAt: localInputInZone(new Date(booking.startsAt), booking.timeZone), endsAt: localInputInZone(new Date(booking.endsAt), booking.timeZone), quantity: booking.quantity, hasOverride: booking.hasOccurrenceOverride });
    setError(""); setNotice("");
  }

  async function saveOccurrenceEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!occurrenceEdit) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await mutate(`/api/modules/resource-scheduler/series/${occurrenceEdit.seriesId}/occurrences/${occurrenceEdit.date}`, "PUT", { startsAt: occurrenceEdit.timeZone ? zonedInputToUtc(occurrenceEdit.startsAt, occurrenceEdit.timeZone) : new Date(occurrenceEdit.startsAt).toISOString(), endsAt: occurrenceEdit.timeZone ? zonedInputToUtc(occurrenceEdit.endsAt, occurrenceEdit.timeZone) : new Date(occurrenceEdit.endsAt).toISOString(), quantity: Number(occurrenceEdit.quantity) });
      setOccurrenceEdit(null); setNotice("Occurrence override saved."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save this occurrence override."); }
    finally { setSaving(false); }
  }

  async function resetOccurrenceOverride() {
    if (!occurrenceEdit?.hasOverride) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await mutate(`/api/modules/resource-scheduler/series/${occurrenceEdit.seriesId}/occurrences/${occurrenceEdit.date}/override`, "DELETE");
      setOccurrenceEdit(null); setNotice("Occurrence restored to the series defaults."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not reset this occurrence override."); }
    finally { setSaving(false); }
  }

  function openFutureEdit(booking: Booking) {
    if (!booking.seriesId) return;
    const recurrence = booking.recurrence ?? { frequency: "once" };
    setFutureEdit({ seriesId: booking.seriesId, timeZone: booking.timeZone, fromDate: booking.occurrenceDate ?? booking.startsAt.slice(0, 10), purpose: booking.purpose, startsAt: localInputInZone(new Date(booking.startsAt), booking.timeZone), endsAt: localInputInZone(new Date(booking.endsAt), booking.timeZone), quantity: booking.quantity, leadInMinutes: booking.leadInMinutes, cleanupMinutes: booking.cleanupMinutes, frequency: recurrence.frequency, interval: recurrence.interval ?? 1, endsOn: recurrence.endsOn ?? "" });
    setFuturePreview(null); setError(""); setNotice("");
  }

  function futureEditPayload(value: FutureEditForm) {
    const recurrence: Record<string, unknown> = { frequency: value.frequency, interval: Number(value.interval) || 1 };
    if (value.endsOn && value.frequency !== "once") recurrence.endsOn = value.endsOn;
    return { fromDate: value.fromDate, purpose: value.purpose.trim(), startsAt: value.timeZone ? zonedInputToUtc(value.startsAt, value.timeZone) : new Date(value.startsAt).toISOString(), endsAt: value.timeZone ? zonedInputToUtc(value.endsAt, value.timeZone) : new Date(value.endsAt).toISOString(), quantity: Number(value.quantity), leadInMinutes: Number(value.leadInMinutes), cleanupMinutes: Number(value.cleanupMinutes), recurrence };
  }

  async function previewFutureEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!futureEdit) return;
    setSaving(true); setError(""); setFuturePreview(null);
    try {
      const response = await fetch(`/api/modules/resource-scheduler/series/${futureEdit.seriesId}/edit-preview`, { method: "POST", headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken, "content-type": "application/json" }, body: JSON.stringify(futureEditPayload(futureEdit)) });
      const result = await response.json() as FutureEditPreview | { error?: string };
      if (!response.ok || !("occurrenceCount" in result)) throw new Error("error" in result ? result.error ?? "Could not preview the series edit." : "Could not preview the series edit.");
      setFuturePreview(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not preview the series edit."); }
    finally { setSaving(false); }
  }

  async function applyFutureEdit() {
    if (!futureEdit || !futurePreview || futurePreview.blocked) return;
    setSaving(true); setError("");
    try {
      await mutate(`/api/modules/resource-scheduler/series/${futureEdit.seriesId}/edit-future`, "PUT", futureEditPayload(futureEdit));
      setFutureEdit(null); setFuturePreview(null); setNotice("Future booking occurrences updated."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update future occurrences."); setFuturePreview(null); }
    finally { setSaving(false); }
  }

  const matchingResourceIds = new Set(data.bookings.filter((booking) => days.includes(booking.occurrenceDate ?? booking.startsAt.slice(0, 10))).map((booking) => booking.resourceId));
  const filteredResources = data.resources.filter((resource) =>
    (resourceFilter === "all" || resource.id === resourceFilter) && (!markedOnly || resource.marked)
    && (!search || resource.matchesSearch || matchingResourceIds.has(resource.id)));
  const bookingsFor = (resourceId: string, day: string) => data.bookings.filter((booking) => booking.resourceId === resourceId && (booking.occurrenceDate ?? booking.startsAt.slice(0, 10)) === day);

  function printSchedule() {
    const table = matrixRef.current?.querySelector("table");
    if (!table || loading || loadedScope !== scope) return;

    const popup = window.open("", "_blank", "width=1100,height=760");
    if (!popup) {
      setError("Allow pop-ups to print the resource schedule.");
      return;
    }
    popup.opener = null;

    const doc = popup.document;
    doc.title = "Weekly resource schedule";
    const style = doc.createElement("style");
    style.textContent = `
      @page { size: landscape; margin: 12mm; }
      body { font: 12px/1.4 system-ui, sans-serif; color: #111; margin: 16px; }
      h1 { margin: 0; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      thead { display: table-header-group; }
      th, td { border: 1px solid #777; padding: 5px; vertical-align: top; text-align: left; overflow-wrap: anywhere; }
      article { break-inside: avoid; border-bottom: 1px solid #bbb; padding: 3px 0; }
      article:last-child { border-bottom: 0; }
      strong, span, small { display: block; }
      svg { display: none; }
      @media print { body { margin: 0; } }
    `;
    doc.head.append(style);
    const heading = doc.createElement("h1");
    heading.textContent = "Weekly resource schedule";
    const summary = doc.createElement("p");
    const resource = data.resources.find((item) => item.id === resourceFilter)?.name ?? "All resources";
    const status = statusFilter === "all" ? "All statuses" : statusLabels[statusFilter as Booking["status"]];
    summary.textContent = `${from} to ${to} · ${resource} · ${status} · ${data.timeZone}${markedOnly ? " · Marked only" : ""}${search ? ` · Search: ${search}` : ""}`;
    const printedTable = doc.importNode(table, true);
    printedTable.querySelectorAll("button, .resource-booking-actions").forEach((item) => item.remove());
    doc.body.replaceChildren(heading, summary, printedTable);
    popup.focus();
    popup.print();
  }

  return <main className="resource-scheduler-page">
    <header className="page-heading resource-scheduler-heading"><div><div className="eyebrow">BOOKINGS</div><h1>Resource Scheduler</h1><p className="page-subtitle">Check availability, request recurring bookings, and manage setup and cleanup buffers.</p></div><button className="button button-primary" type="button" onClick={startRequest}><Plus size={16} /> Request booking</button></header>
    {error && <p className="resource-scheduler-message is-error" role="alert">{error}</p>}{notice && <p className="resource-scheduler-message is-success" role="status">{notice}</p>}
    <nav className="resource-scheduler-week" aria-label="Resource scheduler views">
      <button className="button button-secondary" type="button" aria-pressed={!showMyBookings} onClick={() => setShowMyBookings(false)}>Schedule</button>
      <button className="button button-secondary" type="button" aria-pressed={showMyBookings} onClick={() => setShowMyBookings(true)}>My bookings</button>
    </nav>
    {showMyBookings ? <MyResourceBookings key={departmentId} departmentId={departmentId} refreshVersion={bookedDaysRevision}
      statusLabels={statusLabels} onHistory={(bookingId, title) => setBookingHistory({ departmentId, bookingId, title })} /> : <>
    <section className="resource-scheduler-toolbar"><div className="resource-scheduler-week"><button className="icon-button" type="button" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}><ChevronLeft size={18} /></button><strong>{formatDay(from)} — {formatDay(to)}</strong><button className="icon-button" type="button" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))}><ChevronRight size={18} /></button><button className="button button-secondary" type="button" onClick={() => setWeek(monday(new Date().toISOString().slice(0, 10)))}>This week</button></div><div className="resource-scheduler-filters"><label>Search<input type="search" maxLength={100} value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Resources or bookings" /></label><label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All</option><option value="requested">Pending</option><option value="approved">Confirmed</option><option value="declined">Rejected</option><option value="cancelled">Cancelled</option></select></label><label>Resource<select value={resourceFilter} onChange={(event) => setResourceFilter(event.target.value)}><option value="all">All resources</option>{data.resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select></label><label className="resource-scheduler-marked-filter"><input type="checkbox" checked={markedOnly} onChange={(event) => setMarkedOnly(event.target.checked)} /> Marked only</label><button className="button button-secondary" type="button" disabled={loading || loadedScope !== scope} onClick={printSchedule}><Printer size={16} /> Print schedule</button><button className="button button-secondary" type="button" aria-expanded={showBookedDays} disabled={loadedDepartment !== departmentId} onClick={() => setShowBookedDays((visible) => !visible)}>{showBookedDays ? "Hide booked days" : "Booked days report"}</button></div></section>
    {showBookedDays && loadedDepartment === departmentId && <ResourceBookedDays key={`${departmentId}|${data.timeZone}`}
      departmentId={departmentId} timeZone={data.timeZone} resourceId={resourceFilter !== "all" ? resourceFilter : undefined}
      markedOnly={markedOnly} refreshVersion={bookedDaysRevision} />}
    <section className="resource-scheduler-matrix-wrap" ref={matrixRef}><table className="resource-scheduler-matrix"><thead><tr><th>Resource</th>{days.map((day) => <th key={day}>{formatDay(day)}</th>)}</tr></thead><tbody>{loading || loadedScope !== scope ? <tr><td colSpan={8} className="resource-scheduler-empty">{error ? "Schedule unavailable" : "Loading schedule…"}</td></tr> : filteredResources.map((resource) => <tr key={resource.id}><th scope="row"><strong>{resource.name}</strong><button className="resource-settings-button" type="button" disabled={marking || loadedScope !== scope} aria-pressed={resource.marked} aria-label={`Mark ${resource.name}`} onClick={() => void toggleResourceMark(resource)}><Star size={13} fill={resource.marked ? "currentColor" : "none"} /> {resource.marked ? "Marked" : "Mark"}</button><small>{resource.location || resource.category} · {resource.totalUnits} {resource.totalUnits === 1 ? "unit" : "units"}</small>{canManage && <button className="resource-settings-button" type="button" onClick={() => setEditingResource(resource)}><Settings2 size={13} /> Availability</button>}</th>{days.map((day) => <td key={day}>{bookingsFor(resource.id, day).map((booking) => <article key={booking.id} className={`resource-scheduler-booking status-${booking.status}`}><strong>{formatTime(booking.startsAt, booking.timeZone)}–{formatTime(booking.endsAt, booking.timeZone)}</strong><span>{booking.purpose}</span><small>{statusLabels[booking.status]} · {booking.quantity} {booking.quantity === 1 ? "unit" : "units"} · {booking.requesterName}{booking.hasOccurrenceOverride ? " · Date override" : ""}</small>{booking.leadInMinutes + booking.cleanupMinutes > 0 && <small><Clock3 size={12} /> {booking.leadInMinutes}m setup · {booking.cleanupMinutes}m cleanup</small>}{booking.hasLinkedAppointment && <small>Linked to calendar appointment</small>}{(canManage || booking.canCancel) && <div className="resource-booking-actions"><button type="button" onClick={() => setBookingHistory({ departmentId, bookingId: booking.id, title: booking.resourceName })}><History size={13} /> Booking history</button></div>}{canManage && booking.status === "requested" && <div className="resource-booking-actions"><button type="button" onClick={() => void changeStatus(booking,"approved")}>Approve</button><button type="button" onClick={() => void changeStatus(booking,"declined")}>Reject</button></div>}{booking.status !== "cancelled" && booking.status !== "declined" && booking.canCancel && <div className="resource-booking-actions"><button type="button" onClick={() => void changeStatus(booking,"cancelled")}>Cancel</button>{booking.seriesId && booking.canEditSeries && <>{booking.status === "requested" && <button type="button" onClick={() => openOccurrenceEdit(booking)}><Pencil size={13} /> Edit date</button>}<button type="button" onClick={() => openFutureEdit(booking)}><Pencil size={13} /> Edit future</button><button type="button" onClick={() => void openSeriesHistory(booking.seriesId!)}><History size={13} /> Series history</button><button type="button" onClick={() => { setDateAction({ seriesId: booking.seriesId!, action: "extra" }); setDateValue(""); }}>Add date</button><button type="button" onClick={() => void openExtraDates(booking.seriesId!)}>Extra dates</button><button type="button" onClick={() => { setDateAction({ seriesId: booking.seriesId!, action: "exclude" }); setDateValue(day); }}>Skip date</button><button type="button" onClick={() => void archiveSeries(booking.seriesId!)}>Cancel series</button></>}</div>}</article>)}</td>)}</tr>)}{!filteredResources.length && <tr><td colSpan={8} className="resource-scheduler-empty">{search ? "No resources or bookings match the search." : markedOnly ? "No marked resources match the current filter." : "No bookable resources are available for this location."}</td></tr>}</tbody></table></section>

    </>}
    {showRequest && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowRequest(false)}><section className="modal resource-scheduler-modal" role="dialog" aria-modal="true" aria-labelledby="resource-request-title"><div className="modal-heading"><div><span className="eyebrow">RESOURCE REQUEST</span><h2 id="resource-request-title">Request a booking</h2><p>Times use the location time zone ({data.timeZone}). Conflicts and unit availability are checked before saving. Book Calendar-required resources from a saved Calendar appointment.</p></div><button className="icon-button" type="button" aria-label="Close" onClick={() => setShowRequest(false)}><X size={18} /></button></div><form onSubmit={(event) => void createSeries(event)}><label>Resource<select required value={form.resourceId} onChange={(event) => { const resource = data.resources.find((item) => item.id === event.target.value); setForm((current) => ({ ...current, resourceId: event.target.value, leadInMinutes: resource?.defaultLeadInMinutes ?? 0, cleanupMinutes: resource?.defaultCleanupMinutes ?? 0 })); }}><option value="">Choose a resource</option>{data.resources.filter((item) => item.active).map((resource) => <option key={resource.id} value={resource.id} disabled={resource.calendarRequired || (resource.managerBookingOnly && !canManage)}>{resource.name} · {resource.location || resource.category}{resource.calendarRequired ? " · Calendar required" : ""}{resource.managerBookingOnly ? " · Managers only" : ""}</option>)}</select></label><label>Purpose<input required maxLength={240} value={form.purpose} onChange={(event) => setForm((current) => ({ ...current, purpose: event.target.value }))} /></label><div className="resource-scheduler-field-grid"><label>Start<input type="datetime-local" required value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} /></label><label>End<input type="datetime-local" required value={form.endsAt} onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))} /></label></div><label>Repeat<select value={form.recurrence} onChange={(event) => setForm((current) => ({ ...current, recurrence: event.target.value }))}><option value="once">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>{form.recurrence !== "once" && <div className="resource-scheduler-field-grid"><label>Every<input type="number" min={1} max={366} value={form.interval} onChange={(event) => setForm((current) => ({ ...current, interval: Number(event.target.value) }))} /></label><label>Repeat through<input type="date" value={form.endsOn} onChange={(event) => setForm((current) => ({ ...current, endsOn: event.target.value }))} /></label></div>}<div className="resource-scheduler-field-grid"><label>Quantity<input type="number" min={1} max={10000} value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: Number(event.target.value) }))} /></label><label>Setup / lead-in (minutes)<input type="number" min={0} max={10080} value={form.leadInMinutes} onChange={(event) => setForm((current) => ({ ...current, leadInMinutes: Number(event.target.value) }))} /></label><label>Cleanup (minutes)<input type="number" min={0} max={10080} value={form.cleanupMinutes} onChange={(event) => setForm((current) => ({ ...current, cleanupMinutes: Number(event.target.value) }))} /></label></div><label>Extra dates (comma-separated, YYYY-MM-DD)<input placeholder="2026-12-24, 2026-12-31" value={form.extraDates} onChange={(event) => setForm((current) => ({ ...current, extraDates: event.target.value }))} /></label><label>Skip dates (comma-separated, YYYY-MM-DD)<input placeholder="2026-12-25" value={form.excludedDates} onChange={(event) => setForm((current) => ({ ...current, excludedDates: event.target.value }))} /></label>{canManage && <label>Link to calendar appointment<select value={form.linkedAppointmentId} onChange={(event) => setForm((current) => ({ ...current, linkedAppointmentId: event.target.value }))}><option value="">No appointment link</option>{appointments.map((appointment) => <option key={`${appointment.appointmentId}-${appointment.occurrenceStartAt}`} value={appointment.appointmentId}>{appointment.title} · {formatTime(appointment.occurrenceStartAt)} · {appointment.calendarName}</option>)}</select></label>}{previewResource && <>
      {form.recurrence !== "once" && <small>The availability check covers the selected time. The full series is checked when you save.</small>}
      <ResourceAvailabilityCheck
        key={JSON.stringify([departmentId, form.resourceId, form.startsAt, form.endsAt, form.quantity, form.leadInMinutes, form.cleanupMinutes])}
        getWindow={() => ({ startsAt: zonedInputToUtc(form.startsAt, data.timeZone), endsAt: zonedInputToUtc(form.endsAt, data.timeZone) })}
        headers={{ "x-department-id": departmentId, "x-csrf-token": csrfToken }}
        selections={[{ resourceId: previewResource.id, name: previewResource.name, quantity: Number(form.quantity),
          leadInMinutes: Number(form.leadInMinutes), cleanupMinutes: Number(form.cleanupMinutes) }]}
        disabled={saving || !form.startsAt || !form.endsAt}
      />
    </>}<div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setShowRequest(false)}>Cancel</button><button className="button button-primary" type="submit" disabled={saving || (previewResource?.managerBookingOnly && !canManage)}>{saving ? "Checking availability…" : "Save booking request"}</button></div></form></section></div>}

    {editingResource && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEditingResource(null)}><section className="modal resource-scheduler-modal" role="dialog" aria-modal="true" aria-labelledby="resource-settings-title"><div className="modal-heading"><div><span className="eyebrow">AVAILABILITY</span><h2 id="resource-settings-title">{editingResource.name}</h2><p>Set the number of units and default setup buffers.</p></div><button className="icon-button" type="button" aria-label="Close" onClick={() => setEditingResource(null)}><X size={18} /></button></div><form onSubmit={(event) => void saveResourceSettings(event)}><label>Units available<input type="number" name="totalUnits" required min={1} max={10000} defaultValue={editingResource.totalUnits} /></label><div className="resource-scheduler-field-grid"><label>Default lead-in minutes<input type="number" name="defaultLeadInMinutes" min={0} max={10080} defaultValue={editingResource.defaultLeadInMinutes} /></label><label>Default cleanup minutes<input type="number" name="defaultCleanupMinutes" min={0} max={10080} defaultValue={editingResource.defaultCleanupMinutes} /></label></div><label><span><input type="checkbox" name="calendarRequired" defaultChecked={editingResource.calendarRequired} /> Require a saved Calendar occurrence for new bookings</span></label>
      <label><span><input type="checkbox" name="managerBookingOnly" defaultChecked={editingResource.managerBookingOnly} /> Only resource managers can make new bookings</span></label>
      <label>Who can see and request this resource
        <select name="visibilityGroupId" defaultValue={editingResource.visibilityGroupId ?? ""}>
          <option value="">Everyone at this location</option>
          {editingResource.visibilityGroupId && !data.visibilityGroups?.some((group) => group.id === editingResource.visibilityGroupId)
            && <option value={editingResource.visibilityGroupId}>Current group (inactive or unavailable)</option>}
          {data.visibilityGroups?.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
        <small>Resource managers retain access. People can still manage bookings they already own.</small>
      </label>
      <label>Responsible person
        <select name="responsibleUserId" defaultValue={editingResource.responsibleUserId ?? ""}>
          <option value="">Notify all eligible managers</option>
          {editingResource.responsibleUserId && !data.responsiblePeople?.some((person) => person.id === editingResource.responsibleUserId)
            && <option value={editingResource.responsibleUserId}>Current assignment (no longer eligible)</option>}
          {data.responsiblePeople?.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}
        </select>
        <small>Pending requests go to this person while they can manage bookings. Otherwise they go to the eligible managers.</small>
      </label><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setEditingResource(null)}>Cancel</button><button className="button button-primary" type="submit">Save availability</button></div></form></section></div>}

    {occurrenceEdit && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOccurrenceEdit(null)}><section className="modal resource-scheduler-modal" role="dialog" aria-modal="true" aria-labelledby="occurrence-edit-title"><div className="modal-heading"><div><span className="eyebrow">RECURRING BOOKING</span><h2 id="occurrence-edit-title">Edit this date</h2><p>Changes apply only to {occurrenceEdit.date}. Enter times in UTC and keep the occurrence on this UTC date.</p></div><button className="icon-button" type="button" aria-label="Close" onClick={() => setOccurrenceEdit(null)}><X size={18} /></button></div><form onSubmit={(event) => void saveOccurrenceEdit(event)}><label>Date<input type="date" value={occurrenceEdit.date} disabled /></label><div className="resource-scheduler-field-grid"><label>Start (UTC)<input type="datetime-local" required value={occurrenceEdit.startsAt} onChange={(event) => setOccurrenceEdit({ ...occurrenceEdit, startsAt: event.target.value })} /></label><label>End (UTC)<input type="datetime-local" required value={occurrenceEdit.endsAt} onChange={(event) => setOccurrenceEdit({ ...occurrenceEdit, endsAt: event.target.value })} /></label></div><label>Quantity<input type="number" required min={1} max={10000} value={occurrenceEdit.quantity} onChange={(event) => setOccurrenceEdit({ ...occurrenceEdit, quantity: Number(event.target.value) })} /></label><p className="resource-scheduler-empty">Only pending bookings can be edited. Availability and conflicts are checked when you save.</p><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setOccurrenceEdit(null)}>Cancel</button>{occurrenceEdit.hasOverride && <button className="button button-secondary" type="button" onClick={() => void resetOccurrenceOverride()} disabled={saving}>{saving ? "Saving…" : "Reset to series defaults"}</button>}<button className="button button-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save date override"}</button></div></form></section></div>}
{futureEdit && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setFutureEdit(null)}><section className="modal resource-scheduler-modal" role="dialog" aria-modal="true" aria-labelledby="series-edit-title"><div className="modal-heading"><div><span className="eyebrow">RECURRING BOOKING</span><h2 id="series-edit-title">Edit future occurrences</h2><p>Past bookings stay unchanged. Approved future bookings block this edit.</p></div><button className="icon-button" type="button" aria-label="Close" onClick={() => { setFutureEdit(null); setFuturePreview(null); }}><X size={18} /></button></div><form onSubmit={(event) => void previewFutureEdit(event)}><label>Apply from date<input type="date" required value={futureEdit.fromDate} onChange={(event) => { setFutureEdit((current) => { if (!current) return current; const start = new Date(`${event.target.value}T${current.startsAt.slice(11, 16)}`); const duration = new Date(current.endsAt).getTime() - new Date(current.startsAt).getTime(); return { ...current, fromDate: event.target.value, startsAt: localInput(start), endsAt: localInput(new Date(start.getTime() + duration)) }; }); setFuturePreview(null); }} /></label><label>Purpose<input required maxLength={240} value={futureEdit.purpose} onChange={(event) => { setFutureEdit({ ...futureEdit, purpose: event.target.value }); setFuturePreview(null); }} /></label><div className="resource-scheduler-field-grid"><label>Start<input type="datetime-local" required value={futureEdit.startsAt} onChange={(event) => { setFutureEdit({ ...futureEdit, startsAt: event.target.value }); setFuturePreview(null); }} /></label><label>End<input type="datetime-local" required value={futureEdit.endsAt} onChange={(event) => { setFutureEdit({ ...futureEdit, endsAt: event.target.value }); setFuturePreview(null); }} /></label></div><label>Repeat<select value={futureEdit.frequency} onChange={(event) => { setFutureEdit({ ...futureEdit, frequency: event.target.value }); setFuturePreview(null); }}><option value="once">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>{futureEdit.frequency !== "once" && <div className="resource-scheduler-field-grid"><label>Every<input type="number" min={1} max={366} value={futureEdit.interval} onChange={(event) => { setFutureEdit({ ...futureEdit, interval: Number(event.target.value) }); setFuturePreview(null); }} /></label><label>Repeat through<input type="date" value={futureEdit.endsOn} onChange={(event) => { setFutureEdit({ ...futureEdit, endsOn: event.target.value }); setFuturePreview(null); }} /></label></div>}<div className="resource-scheduler-field-grid"><label>Quantity<input type="number" min={1} max={10000} value={futureEdit.quantity} onChange={(event) => { setFutureEdit({ ...futureEdit, quantity: Number(event.target.value) }); setFuturePreview(null); }} /></label><label>Setup / lead-in (minutes)<input type="number" min={0} max={10080} value={futureEdit.leadInMinutes} onChange={(event) => { setFutureEdit({ ...futureEdit, leadInMinutes: Number(event.target.value) }); setFuturePreview(null); }} /></label><label>Cleanup (minutes)<input type="number" min={0} max={10080} value={futureEdit.cleanupMinutes} onChange={(event) => { setFutureEdit({ ...futureEdit, cleanupMinutes: Number(event.target.value) }); setFuturePreview(null); }} /></label></div>{futurePreview && <aside className={`resource-series-edit-preview${futurePreview.blocked ? " is-blocked" : ""}`} aria-live="polite"><strong>{futurePreview.blocked ? "Changes blocked" : "Review these changes"}</strong><p>{futurePreview.occurrenceCount} future occurrences · {futurePreview.addedCount} added · {futurePreview.updatedCount} updated · {futurePreview.cancelledCount} cancelled</p>{futurePreview.visibilityRequired && <p>Access to this resource is required to add new bookings.</p>}{futurePreview.managerRequired && <p>A resource manager must add any new bookings for this resource.</p>}{futurePreview.calendarRequired && <p>Add each new booking from a saved Calendar appointment.</p>}{futurePreview.approvedCount > 0 && <p>{futurePreview.approvedCount} future occurrence(s) are already approved. Nothing can be changed until those bookings are handled individually.</p>}</aside>}<div className="form-actions"><button className="button button-secondary" type="button" onClick={() => { setFutureEdit(null); setFuturePreview(null); }}>Cancel</button>{!futurePreview ? <button className="button button-primary" type="submit" disabled={saving}>{saving ? "Preparing preview…" : "Preview changes"}</button> : <button className="button button-primary" type="button" disabled={saving || futurePreview.blocked} onClick={() => void applyFutureEdit()}>{saving ? "Applying…" : "Confirm and apply changes"}</button>}</div></form></section></div>}
    {bookingHistory?.departmentId === departmentId && <BookingAuditDialog key={bookingHistory.bookingId} {...bookingHistory} onClose={() => setBookingHistory(null)} />}
    {auditDialog?.departmentId === departmentId && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setAuditDialog(null)}><section className="modal resource-scheduler-modal" role="dialog" aria-modal="true" aria-labelledby="series-audit-title"><div className="modal-heading"><div><span className="eyebrow">RECURRING BOOKING</span><h2 id="series-audit-title">Series history</h2></div><button className="icon-button" type="button" aria-label="Close" onClick={() => setAuditDialog(null)}><X size={18} /></button></div><AuditList entries={auditDialog.entries} empty="No changes have been recorded for this booking series." /></section></div>}
    {extraDatesDialog && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setExtraDatesDialog(null)}><section className="modal resource-scheduler-modal" role="dialog" aria-modal="true" aria-labelledby="extra-dates-title"><div className="modal-heading"><div><span className="eyebrow">RECURRING BOOKING</span><h2 id="extra-dates-title">Extra booking dates</h2><p>Remove an added date to cancel its pending booking and take it out of the series.</p></div><button className="icon-button" type="button" aria-label="Close" onClick={() => setExtraDatesDialog(null)}><X size={18} /></button></div>{extraDatesDialog.rows.length ? <ul className="resource-scheduler-extra-dates">{extraDatesDialog.rows.map((row) => <li key={row.date}><span><strong>{row.date}</strong><small>{row.startsAt ? `${formatTime(row.startsAt)}–${formatTime(row.endsAt ?? row.startsAt)} · ${row.status ? statusLabels[row.status] : "No active booking"}` : "No active booking"}</small></span><button type="button" disabled={row.status === "approved"} title={row.status === "approved" ? "Cancel the approved booking individually first." : undefined} onClick={() => void removeExtraDate(row)}>Remove</button></li>)}</ul> : <p className="resource-scheduler-empty">There are no extra dates in this series.</p>}</section></div>}
    {dateAction && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDateAction(null)}><section className="modal resource-scheduler-modal" role="dialog" aria-modal="true" aria-labelledby="series-date-title"><div className="modal-heading"><div><span className="eyebrow">RECURRING BOOKING</span><h2 id="series-date-title">{dateAction.action === "extra" ? "Add an extra date" : "Skip this occurrence"}</h2></div><button className="icon-button" type="button" aria-label="Close" onClick={() => setDateAction(null)}><X size={18} /></button></div><form onSubmit={(event) => void submitDateAction(event)}><label>Date<input required type="date" min={new Date().toISOString().slice(0,10)} value={dateValue} onChange={(event) => setDateValue(event.target.value)} /></label><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setDateAction(null)}>Cancel</button><button className="button button-primary" type="submit">{dateAction.action === "extra" ? "Add date" : "Skip date"}</button></div></form></section></div>}
  </main>;
}
