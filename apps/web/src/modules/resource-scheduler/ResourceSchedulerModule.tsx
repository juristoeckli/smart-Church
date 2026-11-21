import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, History, Pencil, Plus, Settings2, X } from "lucide-react";
import "./resource-scheduler.css";

type Resource = { id: string; name: string; category: string; location: string; active: boolean; requires_approval: boolean; totalUnits: number; defaultLeadInMinutes: number; defaultCleanupMinutes: number };
type Booking = { id: string; resourceId: string; resourceName: string; location: string; requestedBy: string; requesterName: string; purpose: string; startsAt: string; endsAt: string; status: "requested" | "approved" | "declined" | "cancelled"; quantity: number; leadInMinutes: number; cleanupMinutes: number; seriesId: string | null; recurrence: { frequency: string; interval?: number; endsOn?: string; count?: number; weekdays?: number[] } | null; isExtraDate: boolean; hasOccurrenceOverride: boolean; linkedAppointmentId: string | null; canCancel: boolean; canEditSeries: boolean };
type Appointment = { appointmentId: string; title: string; occurrenceStartAt: string; calendarName: string };
type Bootstrap = { resources: Resource[]; bookings: Booking[]; canManage: boolean; from: string; to: string };
type SeriesAudit = { id: string; action: string; details: Record<string, unknown>; createdAt: string; actorName: string | null };
type FutureEditForm = { seriesId: string; fromDate: string; purpose: string; startsAt: string; endsAt: string; quantity: number; leadInMinutes: number; cleanupMinutes: number; frequency: string; interval: number; endsOn: string };
type FutureEditPreview = { fromDate: string; occurrenceCount: number; addedCount: number; updatedCount: number; cancelledCount: number; approvedCount: number; blocked: boolean };
type OccurrenceEdit = { seriesId: string; date: string; startsAt: string; endsAt: string; quantity: number; hasOverride: boolean };
type ExtraDate = { date: string; bookingId: string | null; status: Booking["status"] | null; startsAt: string | null; endsAt: string | null };

function addDays(value: string, count: number) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + count); return date.toISOString().slice(0, 10); }
function monday(value: string) { const day = new Date(`${value}T12:00:00Z`).getUTCDay(); return addDays(value, -((day + 6) % 7)); }
function localInput(date: Date) { return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
function formatTime(value: string) { return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function formatDay(value: string) { return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)); }
const statusLabels: Record<Booking["status"], string> = { requested: "Pending", approved: "Confirmed", declined: "Rejected", cancelled: "Cancelled" };

export function ResourceSchedulerModule({ departmentId, csrfToken, canManage }: { departmentId: string; csrfToken: string; canManage: boolean }) {
  const [week, setWeek] = useState(() => monday(new Date().toISOString().slice(0, 10)));
  const [statusFilter, setStatusFilter] = useState("all");
  const [resourceFilter, setResourceFilter] = useState("all");
  const [data, setData] = useState<Bootstrap>({ resources: [], bookings: [], canManage: false, from: "", to: "" });
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showRequest, setShowRequest] = useState(false);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [dateAction, setDateAction] = useState<{ seriesId: string; action: "extra" | "exclude" } | null>(null);
  const [dateValue, setDateValue] = useState("");
  const [auditDialog, setAuditDialog] = useState<{ seriesId: string; entries: SeriesAudit[] } | null>(null);
  const [futureEdit, setFutureEdit] = useState<FutureEditForm | null>(null);
  const [futurePreview, setFuturePreview] = useState<FutureEditPreview | null>(null);
  const [extraDatesDialog, setExtraDatesDialog] = useState<{ seriesId: string; rows: ExtraDate[] } | null>(null);
  const [occurrenceEdit, setOccurrenceEdit] = useState<OccurrenceEdit | null>(null);
  const [form, setForm] = useState({ resourceId: "", purpose: "", startsAt: localInput(new Date(Date.now() + 86_400_000)), endsAt: localInput(new Date(Date.now() + 86_400_000 + 3_600_000)), quantity: 1, recurrence: "once", interval: 1, endsOn: "", leadInMinutes: 0, cleanupMinutes: 0, extraDates: "", excludedDates: "", linkedAppointmentId: "" });

  const from = week;
  const to = addDays(week, 6);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(week, index)), [week]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError("");
    try {
      const query = new URLSearchParams({ from, to, status: statusFilter, ...(resourceFilter !== "all" ? { resourceId: resourceFilter } : {}) });
      const response = await fetch(`/api/modules/resource-scheduler/bootstrap?${query}`, { headers: { "x-department-id": departmentId }, signal });
      const result = await response.json() as Bootstrap | { error?: string };
      if (!response.ok || !("resources" in result)) throw new Error("error" in result ? result.error ?? "Could not load resource schedule." : "Could not load resource schedule.");
      setData(result);
    } catch (reason) { if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "Could not load resource schedule."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [departmentId, from, resourceFilter, statusFilter, to]);

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

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
  }

  function startRequest() {
    const resource = data.resources.find((item) => item.id === form.resourceId) ?? data.resources.find((item) => item.active);
    if (!resource) { setError("Add an active resource before requesting a booking."); return; }
    setForm((current) => ({ ...current, resourceId: resource.id, leadInMinutes: resource.defaultLeadInMinutes, cleanupMinutes: resource.defaultCleanupMinutes }));
    setShowRequest(true);
    setNotice(""); setError("");
  }

  async function createSeries(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(""); setNotice("");
    const parseDates = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
    try {
      const repeat: Record<string, unknown> = { frequency: form.recurrence, interval: Number(form.interval) || 1 };
      if (form.endsOn && form.recurrence !== "once") repeat.endsOn = form.endsOn;
      await mutate("/api/modules/resource-scheduler/series", "POST", {
        resourceId: form.resourceId, purpose: form.purpose.trim(), startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString(),
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
      await mutate(`/api/modules/resource-scheduler/resources/${editingResource.id}/settings`, "PUT", { totalUnits: Number(formData.get("totalUnits")), defaultLeadInMinutes: Number(formData.get("defaultLeadInMinutes")), defaultCleanupMinutes: Number(formData.get("defaultCleanupMinutes")) });
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
      const result = await response.json() as SeriesAudit[] | { error?: string };
      if (!response.ok || !Array.isArray(result)) throw new Error("error" in result ? result.error ?? "Could not load booking history." : "Could not load booking history.");
      setAuditDialog({ seriesId, entries: result });
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
    setOccurrenceEdit({ seriesId: booking.seriesId, date: booking.startsAt.slice(0, 10), startsAt: booking.startsAt.slice(0, 16), endsAt: booking.endsAt.slice(0, 16), quantity: booking.quantity, hasOverride: booking.hasOccurrenceOverride });
    setError(""); setNotice("");
  }

  async function saveOccurrenceEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!occurrenceEdit) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await mutate(`/api/modules/resource-scheduler/series/${occurrenceEdit.seriesId}/occurrences/${occurrenceEdit.date}`, "PUT", { startsAt: `${occurrenceEdit.startsAt}:00Z`, endsAt: `${occurrenceEdit.endsAt}:00Z`, quantity: Number(occurrenceEdit.quantity) });
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
    setFutureEdit({ seriesId: booking.seriesId, fromDate: booking.startsAt.slice(0, 10), purpose: booking.purpose, startsAt: localInput(new Date(booking.startsAt)), endsAt: localInput(new Date(booking.endsAt)), quantity: booking.quantity, leadInMinutes: booking.leadInMinutes, cleanupMinutes: booking.cleanupMinutes, frequency: recurrence.frequency, interval: recurrence.interval ?? 1, endsOn: recurrence.endsOn ?? "" });
    setFuturePreview(null); setError(""); setNotice("");
  }

  function futureEditPayload(value: FutureEditForm) {
    const recurrence: Record<string, unknown> = { frequency: value.frequency, interval: Number(value.interval) || 1 };
    if (value.endsOn && value.frequency !== "once") recurrence.endsOn = value.endsOn;
    return { fromDate: value.fromDate, purpose: value.purpose.trim(), startsAt: new Date(value.startsAt).toISOString(), endsAt: new Date(value.endsAt).toISOString(), quantity: Number(value.quantity), leadInMinutes: Number(value.leadInMinutes), cleanupMinutes: Number(value.cleanupMinutes), recurrence };
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

  const filteredResources = data.resources.filter((resource) => resourceFilter === "all" || resource.id === resourceFilter);
  const bookingsFor = (resourceId: string, day: string) => data.bookings.filter((booking) => booking.resourceId === resourceId && booking.startsAt.slice(0, 10) === day);

  return <main className="resource-scheduler-page">
    <header className="page-heading resource-scheduler-heading"><div><div className="eyebrow">BOOKINGS</div><h1>Resource Scheduler</h1><p className="page-subtitle">Check availability, request recurring bookings, and manage setup and cleanup buffers.</p></div><button className="button button-primary" type="button" onClick={startRequest}><Plus size={16} /> Request booking</button></header>
    {error && <p className="resource-scheduler-message is-error" role="alert">{error}</p>}{notice && <p className="resource-scheduler-message is-success" role="status">{notice}</p>}
    <section className="resource-scheduler-toolbar"><div className="resource-scheduler-week"><button className="icon-button" type="button" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}><ChevronLeft size={18} /></button><strong>{formatDay(from)} — {formatDay(to)}</strong><button className="icon-button" type="button" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))}><ChevronRight size={18} /></button><button className="button button-secondary" type="button" onClick={() => setWeek(monday(new Date().toISOString().slice(0, 10)))}>This week</button></div><div className="resource-scheduler-filters"><label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All</option><option value="requested">Pending</option><option value="approved">Confirmed</option><option value="declined">Rejected</option><option value="cancelled">Cancelled</option></select></label><label>Resource<select value={resourceFilter} onChange={(event) => setResourceFilter(event.target.value)}><option value="all">All resources</option>{data.resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select></label></div></section>
    <section className="resource-scheduler-matrix-wrap"><table className="resource-scheduler-matrix"><thead><tr><th>Resource</th>{days.map((day) => <th key={day}>{formatDay(day)}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={8} className="resource-scheduler-empty">Loading schedule…</td></tr> : filteredResources.map((resource) => <tr key={resource.id}><th scope="row"><strong>{resource.name}</strong><small>{resource.location || resource.category} · {resource.totalUnits} {resource.totalUnits === 1 ? "unit" : "units"}</small>{canManage && <button className="resource-settings-button" type="button" onClick={() => setEditingResource(resource)}><Settings2 size={13} /> Availability</button>}</th>{days.map((day) => <td key={day}>{bookingsFor(resource.id, day).map((booking) => <article key={booking.id} className={`resource-scheduler-booking status-${booking.status}`}><strong>{formatTime(booking.startsAt)}–{formatTime(booking.endsAt)}</strong><span>{booking.purpose}</span><small>{statusLabels[booking.status]} · {booking.quantity} {booking.quantity === 1 ? "unit" : "units"} · {booking.requesterName}{booking.hasOccurrenceOverride ? " · Date override" : ""}</small>{booking.leadInMinutes + booking.cleanupMinutes > 0 && <small><Clock3 size={12} /> {booking.leadInMinutes}m setup · {booking.cleanupMinutes}m cleanup</small>}{booking.linkedAppointmentId && <small>Linked to calendar appointment</small>}{canManage && booking.status === "requested" && <div className="resource-booking-actions"><button type="button" onClick={() => void changeStatus(booking,"approved")}>Approve</button><button type="button" onClick={() => void changeStatus(booking,"declined")}>Reject</button></div>}{booking.status !== "cancelled" && booking.status !== "declined" && booking.canCancel && <div className="resource-booking-actions"><button type="button" onClick={() => void changeStatus(booking,"cancelled")}>Cancel</button>{booking.seriesId && booking.canEditSeries && <>{booking.status === "requested" && <button type="button" onClick={() => openOccurrenceEdit(booking)}><Pencil size={13} /> Edit date</button>}<button type="button" onClick={() => openFutureEdit(booking)}><Pencil size={13} /> Edit future</button><button type="button" onClick={() => void openSeriesHistory(booking.seriesId!)}><History size={13} /> History</button><button type="button" onClick={() => { setDateAction({ seriesId: booking.seriesId!, action: "extra" }); setDateValue(""); }}>Add date</button><button type="button" onClick={() => void openExtraDates(booking.seriesId!)}>Extra dates</button><button type="button" onClick={() => { setDateAction({ seriesId: booking.seriesId!, action: "exclude" }); setDateValue(day); }}>Skip date</button><button type="button" onClick={() => void archiveSeries(booking.seriesId!)}>Cancel series</button></>}</div>}</article>)}</td>)}</tr>)}{!filteredResources.length && <tr><td colSpan={8} className="resource-scheduler-empty">No bookable resources are available for this location.</td></tr>}</tbody></table></section>

    {showRequest && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowRequest(false)}><section className="modal resource-scheduler-modal" role="dialog" aria-modal="true" aria-labelledby="resource-request-title"><div className="modal-heading"><div><span className="eyebrow">RESOURCE REQUEST</span><h2 id="resource-request-title">Request a booking</h2><p>Conflicts and unit availability are checked before saving.</p></div><button className="icon-button" type="button" aria-label="Close" onClick={() => setShowRequest(false)}><X size={18} /></button></div><form onSubmit={(event) => void createSeries(event)}><label>Resource<select required value={form.resourceId} onChange={(event) => { const resource = data.resources.find((item) => item.id === event.target.value); setForm((current) => ({ ...current, resourceId: event.target.value, leadInMinutes: resource?.defaultLeadInMinutes ?? 0, cleanupMinutes: resource?.defaultCleanupMinutes ?? 0 })); }}><option value="">Choose a resource</option>{data.resources.filter((item) => item.active).map((resource) => <option key={resource.id} value={resource.id}>{resource.name} · {resource.location || resource.category}</option>)}</select></label><label>Purpose<input required maxLength={240} value={form.purpose} onChange={(event) => setForm((current) => ({ ...current, purpose: event.target.value }))} /></label><div className="resource-scheduler-field-grid"><label>Start<input type="datetime-local" required value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} /></label><label>End<input type="datetime-local" required value={form.endsAt} onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))} /></label></div><label>Repeat<select value={form.recurrence} onChange={(event) => setForm((current) => ({ ...current, recurrence: event.target.value }))}><option value="once">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>{form.recurrence !== "once" && <div className="resource-scheduler-field-grid"><label>Every<input type="number" min={1} max={366} value={form.interval} onChange={(event) => setForm((current) => ({ ...current, interval: Number(event.target.value) }))} /></label><label>Repeat through<input type="date" value={form.endsOn} onChange={(event) => setForm((current) => ({ ...current, endsOn: event.target.value }))} /></label></div>}<div className="resource-scheduler-field-grid"><label>Quantity<input type="number" min={1} max={10000} value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: Number(event.target.value) }))} /></label><label>Setup / lead-in (minutes)<input type="number" min={0} max={10080} value={form.leadInMinutes} onChange={(event) => setForm((current) => ({ ...current, leadInMinutes: Number(event.target.value) }))} /></label><label>Cleanup (minutes)<input type="number" min={0} max={10080} value={form.cleanupMinutes} onChange={(event) => setForm((current) => ({ ...current, cleanupMinutes: Number(event.target.value) }))} /></label></div><label>Extra dates (comma-separated, YYYY-MM-DD)<input placeholder="2026-12-24, 2026-12-31" value={form.extraDates} onChange={(event) => setForm((current) => ({ ...current, extraDates: event.target.value }))} /></label><label>Skip dates (comma-separated, YYYY-MM-DD)<input placeholder="2026-12-25" value={form.excludedDates} onChange={(event) => setForm((current) => ({ ...current, excludedDates: event.target.value }))} /></label>{canManage && <label>Link to calendar appointment<select value={form.linkedAppointmentId} onChange={(event) => setForm((current) => ({ ...current, linkedAppointmentId: event.target.value }))}><option value="">No appointment link</option>{appointments.map((appointment) => <option key={`${appointment.appointmentId}-${appointment.occurrenceStartAt}`} value={appointment.appointmentId}>{appointment.title} · {formatTime(appointment.occurrenceStartAt)} · {appointment.calendarName}</option>)}</select></label>}<div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setShowRequest(false)}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Checking availability…" : "Save booking request"}</button></div></form></section></div>}

    {editingResource && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEditingResource(null)}><section className="modal resource-scheduler-modal" role="dialog" aria-modal="true" aria-labelledby="resource-settings-title"><div className="modal-heading"><div><span className="eyebrow">AVAILABILITY</span><h2 id="resource-settings-title">{editingResource.name}</h2><p>Set the number of units and default setup buffers.</p></div><button className="icon-button" type="button" aria-label="Close" onClick={() => setEditingResource(null)}><X size={18} /></button></div><form onSubmit={(event) => void saveResourceSettings(event)}><label>Units available<input type="number" name="totalUnits" required min={1} max={10000} defaultValue={editingResource.totalUnits} /></label><div className="resource-scheduler-field-grid"><label>Default lead-in minutes<input type="number" name="defaultLeadInMinutes" min={0} max={10080} defaultValue={editingResource.defaultLeadInMinutes} /></label><label>Default cleanup minutes<input type="number" name="defaultCleanupMinutes" min={0} max={10080} defaultValue={editingResource.defaultCleanupMinutes} /></label></div><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setEditingResource(null)}>Cancel</button><button className="button button-primary" type="submit">Save availability</button></div></form></section></div>}

    {occurrenceEdit && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOccurrenceEdit(null)}><section className="modal resource-scheduler-modal" role="dialog" aria-modal="true" aria-labelledby="occurrence-edit-title"><div className="modal-heading"><div><span className="eyebrow">RECURRING BOOKING</span><h2 id="occurrence-edit-title">Edit this date</h2><p>Changes apply only to {occurrenceEdit.date}. Enter times in UTC and keep the occurrence on this UTC date.</p></div><button className="icon-button" type="button" aria-label="Close" onClick={() => setOccurrenceEdit(null)}><X size={18} /></button></div><form onSubmit={(event) => void saveOccurrenceEdit(event)}><label>Date<input type="date" value={occurrenceEdit.date} disabled /></label><div className="resource-scheduler-field-grid"><label>Start (UTC)<input type="datetime-local" required value={occurrenceEdit.startsAt} onChange={(event) => setOccurrenceEdit({ ...occurrenceEdit, startsAt: event.target.value })} /></label><label>End (UTC)<input type="datetime-local" required value={occurrenceEdit.endsAt} onChange={(event) => setOccurrenceEdit({ ...occurrenceEdit, endsAt: event.target.value })} /></label></div><label>Quantity<input type="number" required min={1} max={10000} value={occurrenceEdit.quantity} onChange={(event) => setOccurrenceEdit({ ...occurrenceEdit, quantity: Number(event.target.value) })} /></label><p className="resource-scheduler-empty">Only pending bookings can be edited. Availability and conflicts are checked when you save.</p><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setOccurrenceEdit(null)}>Cancel</button>{occurrenceEdit.hasOverride && <button className="button button-secondary" type="button" onClick={() => void resetOccurrenceOverride()} disabled={saving}>{saving ? "Saving…" : "Reset to series defaults"}</button>}<button className="button button-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save date override"}</button></div></form></section></div>}
{futureEdit && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setFutureEdit(null)}><section className="modal resource-scheduler-modal" role="dialog" aria-modal="true" aria-labelledby="series-edit-title"><div className="modal-heading"><div><span className="eyebrow">RECURRING BOOKING</span><h2 id="series-edit-title">Edit future occurrences</h2><p>Past bookings stay unchanged. Approved future bookings block this edit.</p></div><button className="icon-button" type="button" aria-label="Close" onClick={() => { setFutureEdit(null); setFuturePreview(null); }}><X size={18} /></button></div><form onSubmit={(event) => void previewFutureEdit(event)}><label>Apply from date<input type="date" required value={futureEdit.fromDate} onChange={(event) => { setFutureEdit((current) => { if (!current) return current; const start = new Date(`${event.target.value}T${current.startsAt.slice(11, 16)}`); const duration = new Date(current.endsAt).getTime() - new Date(current.startsAt).getTime(); return { ...current, fromDate: event.target.value, startsAt: localInput(start), endsAt: localInput(new Date(start.getTime() + duration)) }; }); setFuturePreview(null); }} /></label><label>Purpose<input required maxLength={240} value={futureEdit.purpose} onChange={(event) => { setFutureEdit({ ...futureEdit, purpose: event.target.value }); setFuturePreview(null); }} /></label><div className="resource-scheduler-field-grid"><label>Start<input type="datetime-local" required value={futureEdit.startsAt} onChange={(event) => { setFutureEdit({ ...futureEdit, startsAt: event.target.value }); setFuturePreview(null); }} /></label><label>End<input type="datetime-local" required value={futureEdit.endsAt} onChange={(event) => { setFutureEdit({ ...futureEdit, endsAt: event.target.value }); setFuturePreview(null); }} /></label></div><label>Repeat<select value={futureEdit.frequency} onChange={(event) => { setFutureEdit({ ...futureEdit, frequency: event.target.value }); setFuturePreview(null); }}><option value="once">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>{futureEdit.frequency !== "once" && <div className="resource-scheduler-field-grid"><label>Every<input type="number" min={1} max={366} value={futureEdit.interval} onChange={(event) => { setFutureEdit({ ...futureEdit, interval: Number(event.target.value) }); setFuturePreview(null); }} /></label><label>Repeat through<input type="date" value={futureEdit.endsOn} onChange={(event) => { setFutureEdit({ ...futureEdit, endsOn: event.target.value }); setFuturePreview(null); }} /></label></div>}<div className="resource-scheduler-field-grid"><label>Quantity<input type="number" min={1} max={10000} value={futureEdit.quantity} onChange={(event) => { setFutureEdit({ ...futureEdit, quantity: Number(event.target.value) }); setFuturePreview(null); }} /></label><label>Setup / lead-in (minutes)<input type="number" min={0} max={10080} value={futureEdit.leadInMinutes} onChange={(event) => { setFutureEdit({ ...futureEdit, leadInMinutes: Number(event.target.value) }); setFuturePreview(null); }} /></label><label>Cleanup (minutes)<input type="number" min={0} max={10080} value={futureEdit.cleanupMinutes} onChange={(event) => { setFutureEdit({ ...futureEdit, cleanupMinutes: Number(event.target.value) }); setFuturePreview(null); }} /></label></div>{futurePreview && <aside className={`resource-series-edit-preview${futurePreview.blocked ? " is-blocked" : ""}`} aria-live="polite"><strong>{futurePreview.blocked ? "Approval required" : "Review these changes"}</strong><p>{futurePreview.occurrenceCount} future occurrences · {futurePreview.addedCount} added · {futurePreview.updatedCount} updated · {futurePreview.cancelledCount} cancelled</p>{futurePreview.blocked && <p>{futurePreview.approvedCount} future occurrence(s) are already approved. Nothing can be changed until those bookings are handled individually.</p>}</aside>}<div className="form-actions"><button className="button button-secondary" type="button" onClick={() => { setFutureEdit(null); setFuturePreview(null); }}>Cancel</button>{!futurePreview ? <button className="button button-primary" type="submit" disabled={saving}>{saving ? "Preparing preview…" : "Preview changes"}</button> : <button className="button button-primary" type="button" disabled={saving || futurePreview.blocked} onClick={() => void applyFutureEdit()}>{saving ? "Applying…" : "Confirm and apply changes"}</button>}</div></form></section></div>}
    {auditDialog && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setAuditDialog(null)}><section className="modal resource-scheduler-modal" role="dialog" aria-modal="true" aria-labelledby="series-audit-title"><div className="modal-heading"><div><span className="eyebrow">RECURRING BOOKING</span><h2 id="series-audit-title">Booking history</h2></div><button className="icon-button" type="button" aria-label="Close" onClick={() => setAuditDialog(null)}><X size={18} /></button></div>{auditDialog.entries.length ? <ol className="resource-scheduler-history">{auditDialog.entries.map((entry) => <li key={entry.id}><strong>{entry.action.replaceAll("_", " ")}</strong><small>{entry.actorName ?? "System"} · {new Date(entry.createdAt).toLocaleString()}</small><pre>{JSON.stringify(entry.details, null, 2)}</pre></li>)}</ol> : <p className="resource-scheduler-empty">No history is recorded for this booking series yet.</p>}</section></div>}
    {extraDatesDialog && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setExtraDatesDialog(null)}><section className="modal resource-scheduler-modal" role="dialog" aria-modal="true" aria-labelledby="extra-dates-title"><div className="modal-heading"><div><span className="eyebrow">RECURRING BOOKING</span><h2 id="extra-dates-title">Extra booking dates</h2><p>Remove an added date to cancel its pending booking and take it out of the series.</p></div><button className="icon-button" type="button" aria-label="Close" onClick={() => setExtraDatesDialog(null)}><X size={18} /></button></div>{extraDatesDialog.rows.length ? <ul className="resource-scheduler-extra-dates">{extraDatesDialog.rows.map((row) => <li key={row.date}><span><strong>{row.date}</strong><small>{row.startsAt ? `${formatTime(row.startsAt)}–${formatTime(row.endsAt ?? row.startsAt)} · ${row.status ? statusLabels[row.status] : "No active booking"}` : "No active booking"}</small></span><button type="button" disabled={row.status === "approved"} title={row.status === "approved" ? "Cancel the approved booking individually first." : undefined} onClick={() => void removeExtraDate(row)}>Remove</button></li>)}</ul> : <p className="resource-scheduler-empty">There are no extra dates in this series.</p>}</section></div>}
    {dateAction && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDateAction(null)}><section className="modal resource-scheduler-modal" role="dialog" aria-modal="true" aria-labelledby="series-date-title"><div className="modal-heading"><div><span className="eyebrow">RECURRING BOOKING</span><h2 id="series-date-title">{dateAction.action === "extra" ? "Add an extra date" : "Skip this occurrence"}</h2></div><button className="icon-button" type="button" aria-label="Close" onClick={() => setDateAction(null)}><X size={18} /></button></div><form onSubmit={(event) => void submitDateAction(event)}><label>Date<input required type="date" min={new Date().toISOString().slice(0,10)} value={dateValue} onChange={(event) => setDateValue(event.target.value)} /></label><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setDateAction(null)}>Cancel</button><button className="button button-primary" type="submit">{dateAction.action === "extra" ? "Add date" : "Skip date"}</button></div></form></section></div>}
  </main>;
}
