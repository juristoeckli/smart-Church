import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CalendarDays, Check, ClipboardList, Clock3, Download, Link2, MapPin, Music2, Pencil, Plus, Printer, Repeat2, Search, Trash2, UserCheck, Users, X } from "lucide-react";
import type { BookableResource, Contact, CreateServiceEvent, EventRegistration, ServiceEvent, ServiceEventCheckIn, ServiceEventKind, ServicePlanItem, ServicePlanTemplate, ServicePosition, VisitorFollowUp, WorshipSong } from "@smart-church/contracts";
import { formatUserDate } from "./date-format";
import { getActiveLanguage, translate, type TranslationKey } from "./i18n";
import { ModuleTranslationHost, translateModuleText, type DirectorySearchNavigation } from "./module-registry";
import { translationsForModule } from "./modules/translations";
import { mergeModuleTranslationOverrides } from "./modules/ui-translation-overrides";
import { WorshipPlanning } from "./WorshipPlanning";
import { ServiceEventFactsPanel } from "./ServiceEventFactsPanel";
import { EventVolunteerAvailabilityWarning, VolunteerAvailability } from "./VolunteerAvailability";
import { buildStaffingMatrix, StaffingRosterMatrix } from "./StaffingRosterMatrix";
import { csvCell, printHtml } from "./service-exports";
import { openServicePlanPrint, servicePlanSectionHeading } from "./service-plan-print";
import { servicePlanLinkUrl } from "./service-plan-link";
import { buildOwnDutyRows, OwnDutyExports } from "./OwnDutyExports";

type EventFilter = "upcoming" | "all" | "past";
type ScheduleView = "list" | "month" | "attendance" | "workload" | "roster";
const UNCATEGORIZED_ROLE_FILTER = "__uncategorized_roles__";
type ManageableEventRegistration = Omit<EventRegistration, "status"> & { status: EventRegistration["status"] | "cancelled" };
type EventPositionSwap = { id: string; event_id: string; event_title: string; event_date: string; from_position_index: number; from_position_name: string; to_position_index: number; to_position_name: string; requester_contact_id: string; requester_name: string; target_contact_id: string; target_name: string; status: "pending" | "accepted" | "declined" | "cancelled"; created_at: string; canRespond: boolean; canCancel: boolean };
type VolunteerQualification = { id: string; name: string; category: string; active: boolean; contactIds: string[] };

function hasQualifications(contactId: string, requiredIds: string[], qualifications: VolunteerQualification[]) {
  return requiredIds.every((id) => qualifications.find((item) => item.id === id)?.contactIds.includes(contactId));
}

function VolunteerQualificationSettings({ departmentId, contacts, qualifications, onChanged, onClose }: { departmentId: string; contacts: Contact[]; qualifications: VolunteerQualification[]; onChanged: () => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("General");
  const [drafts, setDrafts] = useState<Record<string, { name: string; category: string; active: boolean; contactIds: string[] }>>({});
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusyId("new"); setError("");
    try {
      const response = await fetch("/api/events/volunteer-qualifications", { method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify({ name, category }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not create this qualification.");
      setName(""); await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create this qualification."); }
    finally { setBusyId(""); }
  }
  async function save(qualification: VolunteerQualification) {
    const draft = drafts[qualification.id] ?? qualification;
    setBusyId(qualification.id); setError("");
    try {
      const response = await fetch(`/api/events/volunteer-qualifications/${qualification.id}`, { method: "PUT", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify({ name: draft.name, category: draft.category, active: draft.active }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not save this qualification.");
      if (draft.active) {
        const roster = await fetch(`/api/events/volunteer-qualifications/${qualification.id}/volunteers`, { method: "PUT", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify({ contactIds: draft.contactIds }) });
        const rosterResult = await roster.json() as { error?: string };
        if (!roster.ok) throw new Error(rosterResult.error ?? "Could not update the qualified volunteers.");
      }
      await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this qualification."); }
    finally { setBusyId(""); }
  }
  const edit = (item: VolunteerQualification) => drafts[item.id] ?? { name: item.name, category: item.category, active: item.active, contactIds: item.contactIds };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal qualification-manager-modal" role="dialog" aria-modal="true" aria-labelledby="qualification-manager-title"><div className="modal-heading"><div><span className="eyebrow">EVENT STAFFING</span><h2 id="qualification-manager-title">Volunteer qualifications</h2><p>Create categories and match location volunteers to qualifications.</p></div><button className="icon-button" type="button" aria-label="Close" onClick={onClose}><X size={19} /></button></div>
    {error && <p role="alert" className="qualification-manager-error">{error}</p>}
    <form className="qualification-create-form" onSubmit={(event) => void create(event)}><label>Qualification<input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="First aid" /></label><label>Category<input required maxLength={80} value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Safety" /></label><button className="button button-primary" type="submit" disabled={busyId === "new"}>{busyId === "new" ? "Adding…" : "Add qualification"}</button></form>
    <div className="qualification-manager-list">{qualifications.map((item) => { const draft = edit(item); return <article className="qualification-manager-row" key={item.id}><div className="qualification-manager-fields"><label>Name<input maxLength={80} value={draft.name} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { ...draft, name: event.target.value } }))} /></label><label>Category<input maxLength={80} value={draft.category} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { ...draft, category: event.target.value } }))} /></label><label className="qualification-manager-active"><input type="checkbox" checked={draft.active} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { ...draft, active: event.target.checked } }))} /> Active</label></div><label>Volunteers who hold this qualification<select multiple disabled={!draft.active} value={draft.contactIds} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { ...draft, contactIds: Array.from(event.currentTarget.selectedOptions, (option) => option.value) } }))}>{contacts.filter((person) => person.status === "member").map((person) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>)}</select><small>Hold Ctrl or Command to select multiple volunteers.</small></label><button className="button button-secondary" type="button" disabled={busyId === item.id} onClick={() => void save(item)}>{busyId === item.id ? "Saving…" : "Save"}</button></article>; })}{!qualifications.length && <p className="empty-state">No volunteer qualifications have been defined yet.</p>}</div>
    </section></div>;
}

const eventKinds: { value: ServiceEventKind; label: TranslationKey }[] = [
  { value: "service", label: "events.kind.service" },
  { value: "meeting", label: "events.kind.meeting" },
  { value: "community", label: "events.kind.community" },
  { value: "other", label: "events.kind.other" },
];

const eventTranslations = mergeModuleTranslationOverrides("core-events", translationsForModule("core-events"));

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
  return formatUserDate(value);
}

function eventTimeLabel(event: ServiceEvent) {
  return event.isAllDay ? translate("events.allDay") : `${event.startTime}${event.endTime ? `–${event.endTime}` : ""}`;
}

function formatShortDate(value: string) {
  const [day = "", month = ""] = formatUserDate(value).replace(/[./-]/g, " ").split(/\s+/);
  return { day, month };
}

function eventKindLabel(kind: ServiceEventKind) {
  const key = eventKinds.find((item) => item.value === kind)?.label ?? "events.kind.other";
  return translate(key);
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

function VolunteerWorkload({ events, contacts, matchesCategory, onOpenEvent }: {
  events: ServiceEvent[];
  contacts: Contact[];
  matchesCategory: (position: ServicePosition) => boolean;
  onOpenEvent: (event: ServiceEvent) => void;
}) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const invalidRange = Boolean(fromDate && toDate && fromDate > toDate);
  type Assignment = { event: ServiceEvent; role: string; category: string; status: "Confirmed" | "Requested" | "Declined"; index: number };
  const names = new Map(contacts.map((contact) => [contact.id, `${contact.firstName} ${contact.lastName}`]));
  const assignments = new Map<string, Assignment[]>();
  for (const event of events) {
    if (event.cancelledAt || invalidRange || (fromDate && event.eventDate < fromDate) || (toDate && event.eventDate > toDate)) continue;
    for (const [index, position] of (event.positions ?? []).entries()) {
      if (!position.contactId || !matchesCategory(position)) continue;
      const status = position.responseStatus === "accepted" ? "Confirmed" : position.responseStatus === "declined" ? "Declined" : "Requested";
      const rows = assignments.get(position.contactId) ?? [];
      rows.push({ event, role: position.name, category: position.category?.trim() ?? "", status, index });
      assignments.set(position.contactId, rows);
    }
  }
  const people = Array.from(assignments, ([id, rows]) => ({
    id, name: names.get(id) ?? "Unknown volunteer", rows,
    confirmed: rows.filter((row) => row.status === "Confirmed").length,
    requested: rows.filter((row) => row.status === "Requested").length,
    declined: rows.filter((row) => row.status === "Declined").length,
  })).sort((a, b) => (b.confirmed + b.requested) - (a.confirmed + a.requested) || a.name.localeCompare(b.name));

  function exportWorkload() {
    const rows = [
      ["Volunteer", "Date", "Event", "Role category", "Role", "Response"],
      ...people.flatMap((person) => person.rows.map(({ event, role, category, status }) =>
        [person.name, event.eventDate, event.title, category, role, status])),
    ];
    const csv = "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "volunteer-workload.csv";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return <section className="event-workload" aria-label="Volunteer workload">
    <div className="form-row">
      <label>From date<input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} /></label>
      <label>Through date<input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} /></label>
      <button className="button button-secondary" type="button" onClick={exportWorkload} disabled={!people.length}><Download size={15} />Export workload</button>
    </div>
    {invalidRange && <p role="alert">Choose an end date on or after the start date.</p>}
    <p>Assignments for the current event filters. Cancelled events are excluded. Expand a volunteer to open an event.</p>
    {!people.length ? <p className="empty-state">No volunteer assignments match these filters.</p> : people.map((person) => <details key={person.id}>
      <summary><strong>{person.name}</strong><span>{person.confirmed} confirmed · {person.requested} requested · {person.declined} declined</span></summary>
      <ul>{person.rows.map(({ event, role, status, index }) => <li key={`${event.id}:${index}`}>
        <button type="button" className="button button-secondary" onClick={() => onOpenEvent(event)}>{event.title}</button>
        <span>{formatEventDate(event.eventDate)} · {role} · {status}</span>
      </li>)}</ul>
    </details>)}
  </section>;
}

function groupRegistrations(registrations: ManageableEventRegistration[]) {
  const grouped = new Map<string, ManageableEventRegistration[]>();
  for (const registration of registrations) {
    const key = registration.partyId ?? registration.id;
    const group = grouped.get(key) ?? [];
    group.push(registration);
    grouped.set(key, group);
  }
  return Array.from(grouped, ([key, group]) => ({
    key,
    attendees: group.sort((left, right) => Number(Boolean(left.additionalAttendee)) - Number(Boolean(right.additionalAttendee))),
  }));
}

function registrationAttendeeRole(registration: ManageableEventRegistration) {
  if (registration.additionalAttendee) return "Guest";
  return registration.partyId ? "Primary contact" : "";
}

function previousYearDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const prior = new Date(0);
  prior.setUTCFullYear(year - 1, month, 0);
  if (year <= 1 || !Number.isFinite(prior.getTime())) return "";
  return [String(year - 1).padStart(4, "0"), String(month).padStart(2, "0"), String(Math.min(day, prior.getUTCDate())).padStart(2, "0")].join("-");
}

function filterAttendanceDates(events: ServiceEvent[], from: string, through: string) {
  return events.filter((event) => event.attendanceRecordedAt && (!from || event.eventDate >= from) && (!through || event.eventDate <= through));
}

function sumAttendance(events: ServiceEvent[]) {
  return events.reduce((counts, event) => ({
    adults: counts.adults + (event.attendanceAdults ?? 0),
    children: counts.children + (event.attendanceChildren ?? 0),
  }), { adults: 0, children: 0 });
}

function eventPayload(form: HTMLFormElement): CreateServiceEvent {
  const values = new FormData(form);
  const isAllDay = values.get("isAllDay") === "on";
  const endTime = String(values.get("endTime")).trim();
  const description = String(values.get("description")).trim();
  const recurrenceInterval = String(values.get("recurrence") ?? "");
  return {
    title: String(values.get("title")).trim(),
    kind: String(values.get("kind")) as ServiceEventKind,
    eventDate: String(values.get("eventDate")),
    isAllDay,
    startTime: isAllDay ? "00:00" : String(values.get("startTime")),
    ...(!isAllDay && endTime ? { endTime } : {}),
    location: String(values.get("location")).trim(),
    responsibleContactId: String(values.get("responsibleContactId") ?? "") || null,
    ...(description ? { description } : {}),
    registrationEnabled: values.get("registrationEnabled") === "on",
    ...(values.get("registrationCapacity") ? { registrationCapacity: Number(values.get("registrationCapacity")) } : {}),
    ...(recurrenceInterval ? { recurrence: { interval: recurrenceInterval as "weekly" | "biweekly" | "monthly", endDate: String(values.get("recurrenceEndDate")) } } : {}),
  };
}

function EventPositionStaffNotes({ event, departmentId, canManage }: { event: ServiceEvent; departmentId: string; canManage: boolean }) {
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setNotes({}); setMessage(""); setError("");
    void fetch(`/api/events/${event.id}/position-notes`, { headers: { "x-department-id": departmentId }, signal: controller.signal })
      .then(async (response) => ({ response, data: await response.json() as Array<{ positionIndex: number; note: string }> | { error?: string } }))
      .then(({ response, data }) => {
        if (!response.ok || !Array.isArray(data)) return;
        setNotes(Object.fromEntries(data.map((item) => [item.positionIndex, item.note])));
      }).catch(() => {});
    return () => controller.abort();
  }, [departmentId, event.id]);

  async function save(positionIndex: number) {
    setSavingIndex(positionIndex); setMessage(""); setError("");
    try {
      const response = await fetch(`/api/events/${event.id}/positions/${positionIndex}/note`, {
        method: "PUT", headers: { "content-type": "application/json", "x-department-id": departmentId },
        body: JSON.stringify({ note: notes[positionIndex] ?? "" }),
      });
      const data = await response.json() as { error?: string; note?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not save this staff note.");
      setNotes((current) => ({ ...current, [positionIndex]: data.note ?? "" })); setMessage("Staff note saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this staff note."); }
    finally { setSavingIndex(null); }
  }

  if (!event.positions?.length) return null;
  const visiblePositions = event.positions.map((position, positionIndex) => ({ position, positionIndex }))
    .filter(({ positionIndex }) => canManage || Object.prototype.hasOwnProperty.call(notes, positionIndex));
  if (!canManage && !visiblePositions.length) return null;
  return <section className="event-details-section event-staff-notes"><h3>Staff-only role notes</h3>
    {visiblePositions.map(({ position, positionIndex }) => <div className="event-staff-note" key={`${position.name}-${positionIndex}`}>
      <strong>{position.name}</strong>
      {canManage ? <><textarea maxLength={500} rows={3} value={notes[positionIndex] ?? ""} onChange={(change) => setNotes((current) => ({ ...current, [positionIndex]: change.target.value }))} placeholder="Visible only to event managers and the assigned volunteer" /><button className="button button-secondary" type="button" disabled={savingIndex !== null} onClick={() => void save(positionIndex)}>{savingIndex === positionIndex ? "Saving…" : "Save note"}</button></> : <p>{notes[positionIndex]}</p>}
    </div>)}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}

function EventPositionSwapControls({ event, contacts, swaps, selectedTargets, categoryFilter, onSelectTarget, onRequest, onRespond }: {
  event: ServiceEvent; contacts: Contact[]; swaps: EventPositionSwap[]; selectedTargets: Record<string, number>;
  categoryFilter: string;
  onSelectTarget: (positionIndex: number, targetPositionIndex: number) => void;
  onRequest: (positionIndex: number, targetPositionIndex: number) => void;
  onRespond: (swap: EventPositionSwap, decision: "accepted" | "declined" | "cancelled") => void;
}) {
  if (event.cancelledAt) return null;
  const matchesCategory = (position: ServicePosition | undefined) => categoryFilter === "" || (categoryFilter === UNCATEGORIZED_ROLE_FILTER ? !position?.category?.trim() : position?.category?.trim().toLocaleLowerCase() === categoryFilter.toLocaleLowerCase());
  const eventSwaps = swaps.filter((swap) => swap.event_id === event.id && (matchesCategory(event.positions?.[swap.from_position_index]) || matchesCategory(event.positions?.[swap.to_position_index])));
  const labelFor = (positionIndex: number) => `${event.positions?.[positionIndex]?.name ?? "Position"}${event.positions?.[positionIndex]?.contactId ? ` · ${contacts.find((person) => person.id === event.positions?.[positionIndex]?.contactId)?.firstName ?? "Assigned"} ${contacts.find((person) => person.id === event.positions?.[positionIndex]?.contactId)?.lastName ?? "volunteer"}` : ""}`;
  return <div className="event-position-swaps">
    {event.positions?.map((position, positionIndex) => position.canRespond && matchesCategory(position) ? <div className="event-position-swap-request" key={`swap-select-${positionIndex}`}>
      <select aria-label={`Choose a volunteer to swap ${position.name} with`} value={selectedTargets[`${event.id}:${positionIndex}`] ?? -1} onChange={(change) => onSelectTarget(positionIndex, Number(change.target.value))}>
        <option value={-1}>Choose a volunteer to swap with</option>
        {event.positions?.map((target, targetIndex) => target.contactId && targetIndex !== positionIndex && matchesCategory(target) ? <option key={targetIndex} value={targetIndex}>{labelFor(targetIndex)}</option> : null)}
      </select>
      <button type="button" className="button button-secondary" disabled={(selectedTargets[`${event.id}:${positionIndex}`] ?? -1) < 0} onClick={() => onRequest(positionIndex, selectedTargets[`${event.id}:${positionIndex}`] ?? -1)}>Request swap</button>
    </div> : null)}
    {eventSwaps.map((swap) => <div className="event-position-swap-request" key={swap.id}>
      <span>{swap.requester_name} requests a swap: {swap.from_position_name} ↔ {swap.to_position_name} with {swap.target_name} · {swap.status}</span>
      {swap.canRespond && <><button type="button" className="button button-primary" onClick={() => onRespond(swap, "accepted")}>Accept swap</button><button type="button" className="button button-secondary" onClick={() => onRespond(swap, "declined")}>Decline</button></>}
      {swap.canCancel && <button type="button" className="button button-secondary" onClick={() => onRespond(swap, "cancelled")}>Cancel request</button>}
    </div>)}
  </div>;
}

function buildDutyCandidateContext(events: ServiceEvent[], contactId: string, targetDate: string) {
  const assignments = events
    .filter((event) => !event.cancelledAt)
    .flatMap((event) => (event.positions ?? [])
      .filter((position) => position.contactId === contactId)
      .map((position) => ({ event, position })))
    .sort((a, b) => a.event.eventDate.localeCompare(b.event.eventDate)
      || (a.event.startTime ?? "").localeCompare(b.event.startTime ?? ""));
  const active = assignments.filter(({ position }) => position.responseStatus !== "declined");
  const month = targetDate.slice(0, 7);
  return {
    monthlyCount: active.filter(({ event }) => event.eventDate.startsWith(month)).length,
    nextDuty: active.find(({ event }) => event.eventDate >= targetDate),
    history: assignments.filter(({ event }) => event.eventDate <= targetDate).reverse().slice(0, 5),
  };
}

function EventBulkRoleAssignment({ event, rosterEvents, contacts, qualifications, canManage, departmentId, categoryFilter, onAssigned }: { event: ServiceEvent; rosterEvents: ServiceEvent[]; contacts: Contact[]; qualifications: VolunteerQualification[]; canManage: boolean; departmentId: string; categoryFilter: string; onAssigned: () => void }) {
  const [contactId, setContactId] = useState("");
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const matchesCategory = (position: ServicePosition) => categoryFilter === "" || (categoryFilter === UNCATEGORIZED_ROLE_FILTER ? !position.category?.trim() : position.category?.trim().toLocaleLowerCase() === categoryFilter.toLocaleLowerCase());
  const unfilled = (event.positions ?? []).map((position, positionIndex) => ({ position, positionIndex })).filter(({ position }) => !position.contactId && matchesCategory(position));
  const requiredForSelection = [...new Set(unfilled.filter(({ positionIndex }) => selectedIndices.includes(positionIndex)).flatMap(({ position }) => position.qualificationIds ?? []))];
  const eligibleContacts = contacts.filter((person) => hasQualifications(person.id, requiredForSelection, qualifications));
  if (!canManage || event.importedFrom || event.cancelledAt || !unfilled.length) return null;
  const candidate = eligibleContacts.find((person) => person.id === contactId);
  const context = candidate ? buildDutyCandidateContext(rosterEvents, candidate.id, event.eventDate) : undefined;

  async function assign(eventSubmit: FormEvent<HTMLFormElement>) {
    eventSubmit.preventDefault();
    setError(""); setFeedback("");
    if (!contactId || !selectedIndices.length) { setError("Choose a volunteer and at least one unfilled role."); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/events/${event.id}/positions/bulk-assign`, {
        method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId },
        body: JSON.stringify({ contactId, assignments: selectedIndices.map((positionIndex) => ({ positionIndex, positionName: event.positions?.[positionIndex]?.name ?? "" })) }),
      });
      const result = await response.json() as ServiceEvent | { error?: string };
      if (!response.ok || !("id" in result)) throw new Error("error" in result ? result.error ?? "Could not fill these roles." : "Could not fill these roles.");
      const count = selectedIndices.length;
      setSelectedIndices([]); setContactId(""); setFeedback(`Assigned the volunteer to ${count} ${count === 1 ? "role" : "roles"}.`);
      onAssigned();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not fill these roles."); }
    finally { setBusy(false); }
  }

  return <form className="event-bulk-role-assignment" onSubmit={(eventSubmit) => void assign(eventSubmit)}>
    <strong>Fill several unassigned roles</strong>
    <label>Volunteer<select value={contactId} onChange={(change) => setContactId(change.target.value)}><option value="">Choose a volunteer</option>{eligibleContacts.map((person) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>)}</select>{requiredForSelection.length > 0 && <small>Showing only volunteers with every qualification needed for the selected roles.</small>}</label>
    {context && <details className="event-duty-candidate-context" open>
      <summary>Selected volunteer’s duty history</summary>
      <p>{context.monthlyCount} assigned {context.monthlyCount === 1 ? "role" : "roles"} in the service month, excluding declined requests.</p>
      <p>{context.nextDuty ? <>Next duty from this service date: {formatEventDate(context.nextDuty.event.eventDate)} · {context.nextDuty.event.title} · {context.nextDuty.position.name}</> : "No duty from this service date in the loaded roster."}</p>
      {context.history.length > 0 && <ul>{context.history.map(({ event: priorEvent, position }, index) => <li key={priorEvent.id + ":" + index}>
        {formatEventDate(priorEvent.eventDate)} · {priorEvent.title} · {position.name} · {position.responseStatus === "accepted" ? "Confirmed" : position.responseStatus === "declined" ? "Declined" : "Requested"}
      </li>)}</ul>}
    </details>}
    <fieldset><legend>Select roles</legend>{unfilled.map(({ position, positionIndex }) => <label key={positionIndex}><input type="checkbox" checked={selectedIndices.includes(positionIndex)} disabled={Boolean(contactId) && !hasQualifications(contactId, position.qualificationIds ?? [], qualifications)} onChange={(change) => setSelectedIndices((current) => change.target.checked ? [...current, positionIndex] : current.filter((index) => index !== positionIndex))} />{position.name}{position.qualificationIds?.length ? <small> · Requires {position.qualificationIds.map((id) => qualifications.find((item) => item.id === id)?.name ?? "Qualification").join(", ")}</small> : null}</label>)}</fieldset>
    <button className="button button-secondary" type="submit" disabled={busy || !contactId || !selectedIndices.length}>{busy ? "Assigning…" : "Assign selected roles"}</button>
    {feedback && <p role="status">{feedback}</p>}{error && <p role="alert">{error}</p>}
  </form>;
}

export function ServicesEvents({ departmentId, departmentLocation, departmentTimeZone, csrfToken, contacts, canManage, onNotice, linkedSongNavigation, songSearchNavigation, onLinkedSongHandled, linkedEventNavigation, onLinkedEventHandled }: { departmentId: string; departmentLocation: string; departmentTimeZone: string; csrfToken: string; contacts: Contact[]; canManage: boolean; onNotice: (message: string) => void; linkedSongNavigation?: { id: string; requestId: number } | null; songSearchNavigation?: DirectorySearchNavigation; onLinkedSongHandled?: (requestId: number) => void; linkedEventNavigation?: { id: string; requestId: number } | null; onLinkedEventHandled?: (requestId: number) => void }) {
  const [events, setEvents] = useState<ServiceEvent[]>([]);
  const [positionSwaps, setPositionSwaps] = useState<EventPositionSwap[]>([]);
  const [volunteerQualifications, setVolunteerQualifications] = useState<VolunteerQualification[]>([]);
  const [qualificationManagerOpen, setQualificationManagerOpen] = useState(false);
  const [swapTargetByPosition, setSwapTargetByPosition] = useState<Record<string, number>>({});
  const [resources, setResources] = useState<BookableResource[]>([]);
  const [servicePlanTemplates, setServicePlanTemplates] = useState<ServicePlanTemplate[]>([]);
  const [worshipSongs, setWorshipSongs] = useState<WorshipSong[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [eventsDepartmentId, setEventsDepartmentId] = useState("");
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState<EventFilter>("upcoming");
  const [attendanceFrom, setAttendanceFrom] = useState("");
  const [attendanceTo, setAttendanceTo] = useState("");
  useEffect(() => { setAttendanceFrom(""); setAttendanceTo(""); }, [departmentId]);
  const [roleCategoryFilter, setRoleCategoryFilter] = useState("");
  const [responsibleFilter, setResponsibleFilter] = useState("");
  const [staffingFilter, setStaffingFilter] = useState<"all" | "mine" | "requested" | "unfilled">("all");
  const [scheduleView, setScheduleView] = useState<ScheduleView>("list");
  const [calendarMonth, setCalendarMonth] = useState(() => departmentDateString(departmentTimeZone).slice(0, 7));
  const [detailsEvent, setDetailsEvent] = useState<ServiceEvent | null>(null);
  const [query, setQuery] = useState("");
  const [editingEvent, setEditingEvent] = useState<ServiceEvent | null>(null);
  const [attendanceEvent, setAttendanceEvent] = useState<ServiceEvent | null>(null);
  const [attendanceAdults, setAttendanceAdults] = useState("0");
  const [attendanceChildren, setAttendanceChildren] = useState("0");
  const [attendanceSaving, setAttendanceSaving] = useState(false);
  const [checkInEvent, setCheckInEvent] = useState<ServiceEvent | null>(null);
  const [checkIns, setCheckIns] = useState<ServiceEventCheckIn[]>([]);
  const [registrations, setRegistrations] = useState<ManageableEventRegistration[]>([]);
  const [checkInsLoading, setCheckInsLoading] = useState(false);
  const [checkInQuery, setCheckInQuery] = useState("");
  const [followUpQueueOpen, setFollowUpQueueOpen] = useState(false);
  const [followUps, setFollowUps] = useState<VisitorFollowUp[]>([]);
  const [followUpsLoading, setFollowUpsLoading] = useState(false);
  const [followUpFilter, setFollowUpFilter] = useState<"open" | "all">("open");
  const [followUpSavingId, setFollowUpSavingId] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isWorshipLibraryOpen, setIsWorshipLibraryOpen] = useState(false);
  useEffect(() => { if (linkedSongNavigation || songSearchNavigation) setIsWorshipLibraryOpen(true); }, [linkedSongNavigation, songSearchNavigation]);
  useEffect(() => {
    if (!linkedEventNavigation || isLoading || loadError) return;
    const target = events.find((event) => event.id === linkedEventNavigation.id);
    if (target) setDetailsEvent(target);
    else onNotice("This event is no longer available.");
    onLinkedEventHandled?.(linkedEventNavigation.requestId);
  }, [linkedEventNavigation?.requestId, events, isLoading, loadError, onLinkedEventHandled, onNotice]);
  const [selectedPlanTemplateId, setSelectedPlanTemplateId] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isAllDay, setIsAllDay] = useState(false);
  const [room, setRoom] = useState("");
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [positions, setPositions] = useState<ServicePosition[]>([]);
  const [timePlan, setTimePlan] = useState<ServicePlanItem[]>([]);
  const [recurrenceInterval, setRecurrenceInterval] = useState<"" | "weekly" | "biweekly" | "monthly">("");
  const [applyToSeries, setApplyToSeries] = useState(false);

  async function loadVolunteerQualifications(signal?: AbortSignal) {
    if (!canManage) return;
    try {
      const response = await fetch("/api/events/volunteer-qualifications", { headers: { "x-department-id": departmentId }, signal });
      const result = await response.json() as VolunteerQualification[] | { error?: string };
      if (response.ok && Array.isArray(result)) setVolunteerQualifications(result);
    } catch { /* Keep event planning available when the optional qualifications panel is offline. */ }
  }

  async function loadEvents(signal?: AbortSignal) {
    setIsLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/events", { headers: { "x-department-id": departmentId }, signal });
      const result = await response.json() as ServiceEvent[] | { error?: string };
      if (!response.ok || !Array.isArray(result)) {
        throw new Error(!Array.isArray(result) ? result.error ?? "Could not load services and events." : "Could not load services and events.");
      }
      if (signal?.aborted) return;
      setEvents(result);
      setEventsDepartmentId(departmentId);
      const swapsResponse = await fetch("/api/event-position-swaps", { headers: { "x-department-id": departmentId }, signal });
      const swapsData = await swapsResponse.json() as EventPositionSwap[] | { error?: string };
      if (swapsResponse.ok && Array.isArray(swapsData)) setPositionSwaps(swapsData);
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
    void loadVolunteerQualifications(controller.signal);
    return () => controller.abort();
  }, [departmentId, canManage]);

  useEffect(() => {
    const controller = new AbortController();
    const headers = { "x-department-id": departmentId };
    void Promise.all([
      fetch("/api/service-plan-templates", { headers, signal: controller.signal }).then(async (response) => ({ response, data: await response.json() as ServicePlanTemplate[] | { error?: string } })),
      fetch("/api/worship/songs", { headers, signal: controller.signal }).then(async (response) => ({ response, data: await response.json() as WorshipSong[] | { error?: string } })),
    ]).then(([templates, songs]) => {
      if (templates.response.ok && Array.isArray(templates.data)) setServicePlanTemplates(templates.data);
      if (songs.response.ok && Array.isArray(songs.data)) setWorshipSongs(songs.data);
    }).catch(() => {});
    return () => controller.abort();
  }, [departmentId]);

  useEffect(() => {
    if (!detailsEvent) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailsEvent(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [detailsEvent]);

  const today = departmentDateString(departmentTimeZone);
  const currentMonth = today.slice(0, 7);
  const upcomingEvents = useMemo(() => events.filter((event) => event.eventDate >= today), [events, today]);
  const thisMonthCount = events.filter((event) => event.eventDate.startsWith(currentMonth) && event.eventDate >= today).length;
  const filteredEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = events.filter((event) => {
      const matchesFilter = scheduleView === "attendance" || filter === "all" || (filter === "upcoming" ? event.eventDate >= today : event.eventDate < today);
      const matchesQuery = !normalizedQuery || [event.title, event.location, eventKindLabel(event.kind), event.description]
        .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
      return matchesFilter && matchesQuery;
    });
    return scheduleView !== "attendance" && filter === "past" ? filtered.reverse() : filtered;
  }, [events, filter, query, scheduleView, today]);
  const roleCategoryOptions = useMemo(() => [...new Set(events.flatMap((event) => (event.positions ?? []).map((position) => position.category?.trim()).filter((category): category is string => Boolean(category))))].sort((a, b) => a.localeCompare(b)), [events]);
  const hasUncategorizedRoles = useMemo(() => events.some((event) => (event.positions ?? []).some((position) => !position.category?.trim())), [events]);
  const roleCategoryMatches = (position: ServicePosition) => roleCategoryFilter === ""
    || (roleCategoryFilter === UNCATEGORIZED_ROLE_FILTER ? !position.category?.trim() : position.category?.trim().toLocaleLowerCase() === roleCategoryFilter.toLocaleLowerCase());
  const showUnfilledRoles = canManage && staffingFilter === "unfilled";
  const showMyDuties = staffingFilter === "mine" || staffingFilter === "requested";
  const showMyRequests = staffingFilter === "requested";
  const dutyPositionMatches = (position: ServicePosition) =>
    roleCategoryMatches(position) && (!showUnfilledRoles || !position.contactId)
    && (!showMyDuties || Boolean(position.canRespond))
    && (!showMyRequests || (position.responseStatus ?? "pending") === "pending");
  const responsibleContacts = useMemo(() => {
    const responsibleIds = new Set(events.flatMap((event) => event.responsibleContactId ? [event.responsibleContactId] : []));
    return contacts.filter((contact) => responsibleIds.has(contact.id));
  }, [contacts, events]);
  const responsibleName = (event: ServiceEvent) => {
    const contact = responsibleContacts.find((person) => person.id === event.responsibleContactId);
    return contact ? `${contact.firstName} ${contact.lastName}` : "";
  };
  const responsibleMatches = (event: ServiceEvent) => !canManage || !responsibleFilter
    || (responsibleFilter === "unassigned" ? !event.responsibleContactId : event.responsibleContactId === responsibleFilter);
  useEffect(() => setResponsibleFilter(""), [departmentId]);
  const matchingResponsibleEvents = filteredEvents.filter(responsibleMatches);
  const dutyRosterEvents = roleCategoryFilter || showUnfilledRoles || showMyDuties
    ? matchingResponsibleEvents.filter((event) => (!(showUnfilledRoles || showMyRequests) || !event.cancelledAt) && event.positions?.some(dutyPositionMatches))
    : matchingResponsibleEvents;
  const ownDutyRows = scheduleView === "list" && showMyDuties && !isLoading && !loadError && eventsDepartmentId === departmentId
    ? buildOwnDutyRows(dutyRosterEvents, dutyPositionMatches, showMyRequests, eventTimeLabel)
    : [];
  const staffingMatrix = canManage && scheduleView === "roster" && eventsDepartmentId === departmentId
    ? buildStaffingMatrix(dutyRosterEvents, contacts, dutyPositionMatches, formatEventDate, eventTimeLabel) : null;
  const attendanceDatesInvalid = Boolean(attendanceFrom && attendanceTo && attendanceFrom > attendanceTo);
  const attendanceEvents = attendanceDatesInvalid ? [] : filterAttendanceDates(filteredEvents, attendanceFrom, attendanceTo);
  const attendanceCounts = sumAttendance(attendanceEvents);
  const priorFrom = attendanceFrom && previousYearDate(attendanceFrom);
  const priorTo = attendanceTo && previousYearDate(attendanceTo);
  const priorAttendanceEvents = !attendanceDatesInvalid && priorFrom && priorTo ? filterAttendanceDates(filteredEvents, priorFrom, priorTo) : null;
  const priorAttendanceCounts = priorAttendanceEvents?.length ? sumAttendance(priorAttendanceEvents) : null;
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
  const filteredCheckInContacts = contacts.filter((person) => `${person.firstName} ${person.lastName}`.toLocaleLowerCase().includes(checkInQuery.trim().toLocaleLowerCase()));

  function moveCalendarMonth(amount: number) {
    const [year, month] = calendarMonth.split("-").map(Number);
    setCalendarMonth(new Date(Date.UTC(year, month - 1 + amount, 1)).toISOString().slice(0, 7));
  }

  function openCreateModal() {
    setEditingEvent(null);
    setSelectedPlanTemplateId("");
    setIsAllDay(false);
    setRecurrenceInterval(""); setApplyToSeries(false);
    setRoom(""); setAssetIds([]); setPositions([{ name: "Tech" }, { name: "Band" }, { name: "Preacher" }, { name: "Moderation" }]); setTimePlan([]);
    setIsModalOpen(true);
  }

  function openEditModal(event: ServiceEvent) {
    setEditingEvent(event);
    setSelectedPlanTemplateId("");
    setIsAllDay(Boolean(event.isAllDay));
    setRecurrenceInterval(""); setApplyToSeries(false);
    setRoom(event.room ?? ""); setAssetIds(event.assetIds ?? []); setPositions(event.positions ?? []); setTimePlan(event.timePlan ?? []);
    setIsModalOpen(true);
  }

  function applyServicePlanTemplate(templateId: string) {
    setSelectedPlanTemplateId(templateId);
    const template = servicePlanTemplates.find((item) => item.id === templateId);
    if (!template) return;
    setTimePlan(template.items.map((item) => ({ ...item })));
    setPositions(template.positions.map((position) => {
      const previous = positions.find((item) => item.name.trim().toLocaleLowerCase() === position.name.trim().toLocaleLowerCase());
      return { name: position.name, ...(position.category?.trim() ? { category: position.category.trim() } : {}), ...(previous?.contactId ? { contactId: previous.contactId } : {}), ...(position.qualificationIds?.length ? { qualificationIds: [...position.qualificationIds] } : {}) };
    }));
  }

  function updateEventPosition(index: number, name: string) {
    const previousName = positions[index]?.name.trim().toLocaleLowerCase();
    setPositions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name } : item));
    if (previousName) setTimePlan((current) => current.map((item) => item.position?.trim().toLocaleLowerCase() === previousName ? { ...item, position: name } : item));
  }

  function removeEventPosition(index: number) {
    const removedName = positions[index]?.name.trim().toLocaleLowerCase();
    setPositions((current) => current.filter((_, itemIndex) => itemIndex !== index));
    if (removedName) setTimePlan((current) => current.map((item) => item.position?.trim().toLocaleLowerCase() === removedName ? { ...item, position: undefined } : item));
  }

  async function refreshWorshipLibrary() {
    try {
      const headers = { "x-department-id": departmentId };
      const [templateResponse, songResponse] = await Promise.all([
        fetch("/api/service-plan-templates", { headers }),
        fetch("/api/worship/songs", { headers }),
      ]);
      const [templates, songs] = await Promise.all([templateResponse.json(), songResponse.json()]) as [ServicePlanTemplate[] | { error?: string }, WorshipSong[] | { error?: string }];
      if (templateResponse.ok && Array.isArray(templates)) setServicePlanTemplates(templates);
      if (songResponse.ok && Array.isArray(songs)) setWorshipSongs(songs);
    } catch { /* Keep the last successfully loaded library data. */ }
  }

  async function saveEvent(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = formEvent.currentTarget;
    const payload: CreateServiceEvent = { ...eventPayload(form), room, assetIds, positions: positions.filter((position) => position.name.trim()).map(({ name, category, contactId, qualificationIds }) => ({ name, ...(category?.trim() ? { category: category.trim() } : {}), ...(contactId ? { contactId } : {}), ...(qualificationIds?.length ? { qualificationIds } : {}) })), timePlan: timePlan.filter((item) => item.title.trim()).map((item) => ({ ...item, section: item.section?.trim() || undefined, durationMinutes: item.durationMinutes ? Number(item.durationMinutes) : undefined })) };
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
    if (!window.confirm(translateModuleText(`Delete ${target} for “${event.title}” from the schedule?`, translationsForModule("core-events"), getActiveLanguage()))) return;
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

  async function updateEventCancellation(event: ServiceEvent, action: "cancel" | "restore") {
    const reason = action === "cancel"
      ? window.prompt(`Reason for cancelling “${event.title}”:`)?.trim()
      : undefined;
    if (action === "cancel" && !reason) return;
    if (action === "restore" && !window.confirm(`Restore “${event.title}” and reopen its registrations and volunteer responses?`)) return;
    try {
      const response = await fetch(`/api/events/${event.id}/${action === "cancel" ? "cancel" : "restore"}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-department-id": departmentId },
        ...(action === "cancel" ? { body: JSON.stringify({ reason }) } : {}),
      });
      const result = await response.json() as { error?: string; cancelledAt?: string };
      if (!response.ok) throw new Error(result.error ?? `Could not ${action} this event.`);
      const updated = { ...event, ...(action === "cancel" ? { cancelledAt: result.cancelledAt, cancellationReason: reason } : { cancelledAt: undefined, cancellationReason: undefined }) };
      setEvents((current) => current.map((item) => item.id === event.id ? updated : item));
      setDetailsEvent((current) => current?.id === event.id ? updated : current);
      onNotice(action === "cancel" ? `${event.title} was cancelled. Registrations and assignments were retained.` : `${event.title} was restored.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : `Could not ${action} this event.`);
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

  async function refreshPositionSwaps() {
    const response = await fetch("/api/event-position-swaps", { headers: { "x-department-id": departmentId } });
    const result = await response.json() as EventPositionSwap[] | { error?: string };
    if (!response.ok || !Array.isArray(result)) throw new Error(!Array.isArray(result) ? result.error ?? "Could not load swap requests." : "Could not load swap requests.");
    setPositionSwaps(result);
  }

  async function requestPositionSwap(event: ServiceEvent, fromPositionIndex: number, toPositionIndex: number) {
    try {
      const response = await fetch(`/api/events/${event.id}/position-swaps`, { method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify({ fromPositionIndex, toPositionIndex }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not request this swap.");
      await refreshPositionSwaps();
      onNotice("Swap request sent to the assigned volunteer.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Could not request this swap."); }
  }

  async function respondToPositionSwap(swap: EventPositionSwap, decision: "accepted" | "declined" | "cancelled") {
    try {
      const response = await fetch(`/api/event-position-swaps/${swap.id}`, { method: "PUT", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify({ decision }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not update this swap request.");
      if (decision === "accepted") await loadEvents(); else await refreshPositionSwaps();
      onNotice(decision === "accepted" ? "The assignments were swapped." : decision === "declined" ? "Swap request declined." : "Swap request cancelled.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Could not update this swap request."); }
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

  function downloadAttendanceReport() {
    const rows = [
      [translate("events.date"), translate("events.gathering"), translate("events.type"), translate("events.adults"), translate("events.children"), translate("events.total"), translate("events.recordedAt")],
      ...attendanceEvents.map((event) => [event.eventDate, event.title, eventKindLabel(event.kind), String(event.attendanceAdults ?? 0), String(event.attendanceChildren ?? 0), String((event.attendanceAdults ?? 0) + (event.attendanceChildren ?? 0)), event.attendanceRecordedAt ? formatUserDate(event.attendanceRecordedAt, true) : ""]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "church-attendance.csv";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function downloadStaffingReport() {
    const rows = [
      ["Date", "Event", "Type", "Start", "Location", "Responsible person", "Role category", "Role", "Assigned person", "Response"],
      ...dutyRosterEvents.flatMap((event) => (event.positions ?? []).filter(dutyPositionMatches).map((position) => {
        const person = contacts.find((contact) => contact.id === position.contactId);
        const response = position.responseStatus === "accepted" ? "Confirmed" : position.responseStatus === "declined" ? "Declined" : position.contactId ? "Requested" : "Unfilled";
        return [event.eventDate, event.title, eventKindLabel(event.kind), event.isAllDay ? "All day" : event.startTime, event.location, responsibleName(event), position.category?.trim() ?? "", position.name, person ? `${person.firstName} ${person.lastName}` : "", response];
      })),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "event-staffing.csv";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function copyServicePlanLink(eventId: string) {
    try {
      await navigator.clipboard.writeText(servicePlanLinkUrl(window.location.href, departmentId, eventId));
      onNotice("Service plan link copied.");
    } catch {
      onNotice("Could not copy the service plan link.");
    }
  }

  function printRunSheet(event: ServiceEvent) {
    const plan = event.timePlan ?? [];
    if (!plan.length) return;
    const context = [formatEventDate(event.eventDate), eventTimeLabel(event), departmentTimeZone, event.location, event.room].filter(Boolean).join(" · ");
    const opened = openServicePlanPrint({
      title: event.title,
      plan,
      songs: worshipSongs,
      context,
      cancelled: Boolean(event.cancelledAt),
      responsible: responsibleName(event),
      assigneesForRole: (role) => (event.positions ?? []).filter((position) => position.name === role).flatMap((position) => {
        const contact = contacts.find((candidate) => candidate.id === position.contactId);
        return contact ? [contact.firstName + " " + contact.lastName] : [];
      }),
    });
    if (!opened) onNotice("Allow pop-ups to print the service run sheet.");
  }

  function printStaffingReport() {
    const rows = dutyRosterEvents.flatMap((event) => (event.positions ?? []).filter(dutyPositionMatches).map((position) => {
      const person = contacts.find((contact) => contact.id === position.contactId);
      const response = position.responseStatus === "accepted" ? "Confirmed" : position.responseStatus === "declined" ? "Declined" : position.contactId ? "Requested" : "Unfilled";
      return `<tr><td>${printHtml(formatEventDate(event.eventDate))}</td><td>${printHtml(event.title)}${event.cancelledAt ? " <strong class=\"cancelled\">Cancelled</strong>" : ""}</td><td>${printHtml(event.isAllDay ? "All day" : event.startTime)}</td><td>${printHtml(event.location)}${event.room ? ` · ${printHtml(event.room)}` : ""}</td><td>${printHtml(responsibleName(event))}</td><td>${printHtml(position.category?.trim() ?? "")}</td><td>${printHtml(position.name)}</td><td>${printHtml(person ? `${person.firstName} ${person.lastName}` : "")}</td><td>${printHtml(response)}</td></tr>`;
    }));
    if (rows.length === 0) return;
    const popup = window.open("", "_blank", "width=1000,height=750");
    if (!popup) {
      onNotice("Allow pop-ups to print the staffing roster.");
      return;
    }
    popup.opener = null;
    popup.document.open();
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Event staffing roster</title><style>
      @page{size:auto;margin:14mm}body{font:12px/1.4 Arial,sans-serif;color:#17211a;margin:0}h1{font-size:21px;margin:0 0 4px}p{margin:0 0 16px;color:#526057;font-size:11px}table{width:100%;border-collapse:collapse}thead{display:table-header-group}tr{break-inside:avoid}th,td{padding:7px 6px;border:1px solid #cfd6d0;text-align:left;vertical-align:top}th{background:#edf2ed;font-weight:700}.cancelled{color:#a32626;font-size:10px}.print-actions{margin:0 0 14px}@media print{.print-actions{display:none}}
      </style></head><body><div class="print-actions"><button type="button" onclick="window.print()">Print roster</button></div><h1>Event staffing roster</h1><p>${printHtml(roleCategoryFilter ? roleCategoryFilter === UNCATEGORIZED_ROLE_FILTER ? "Uncategorized roles" : roleCategoryFilter : "All role categories")}${showUnfilledRoles ? " · Unfilled roles only" : showMyRequests ? " · My pending requests" : showMyDuties ? " · My assignments" : ""} · ${printHtml(new Date().toLocaleString())}</p><table><thead><tr><th>Date</th><th>Event</th><th>Start</th><th>Location</th><th>Responsible person</th><th>Role category</th><th>Role</th><th>Assigned person</th><th>Response</th></tr></thead><tbody>${rows.join("")}</tbody></table><script>window.addEventListener("load",()=>window.print(),{once:true});</script></body></html>`);
    popup.document.close();
  }

  function downloadRegistrationsReport() {
    if (!checkInEvent || registrations.length === 0) return;
    const rows = [
      [translate("events.firstName"), translate("events.lastName"), translate("events.email"), translate("events.status"), translate("events.registeredAt"), translate("events.checkedInAt"), "Family registration ID", "Attendee role"],
      ...groupRegistrations(registrations).flatMap(({ attendees }) => attendees.map((registration) => [registration.firstName, registration.lastName, registration.email, translate(registration.status === "waitlisted" ? "events.waitlisted" : registration.status === "cancelled" ? "events.cancelled" : "events.registered"), formatUserDate(registration.registeredAt, true), registration.checkedInAt ? formatUserDate(registration.checkedInAt, true) : translate("events.notCheckedIn"), registration.partyId ?? "", registrationAttendeeRole(registration)])),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "event-registrations.csv";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
      const [checkInResult, registrationResult] = await Promise.all([checkInResponse.json(), registrationsResponse.json()]) as [ServiceEventCheckIn[] | { error?: string }, ManageableEventRegistration[] | { error?: string }];
      if (!checkInResponse.ok || !Array.isArray(checkInResult)) throw new Error(!Array.isArray(checkInResult) ? checkInResult.error ?? "Could not load check-ins." : "Could not load check-ins.");
      if (!registrationsResponse.ok || !Array.isArray(registrationResult)) throw new Error(!Array.isArray(registrationResult) ? registrationResult.error ?? "Could not load registrations." : "Could not load registrations.");
      setCheckIns(checkInResult);
      setRegistrations(registrationResult);
    } catch (error) {
      setCheckInEvent(null);
      onNotice(error instanceof Error ? error.message : "Could not load check-ins.");
    } finally { setCheckInsLoading(false); }
  }

  async function setRegistrationCheckedIn(registration: ManageableEventRegistration, checkedIn: boolean) {
    if (!checkInEvent) return;
    try {
      const response = await fetch(`/api/events/${checkInEvent.id}/registrations/${registration.id}/check-in`, {
        method: "PUT", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify({ checkedIn }),
      });
      const result = await response.json() as ManageableEventRegistration | { error?: string };
      if (!response.ok || !("id" in result)) throw new Error("error" in result ? result.error ?? "Could not update registration check-in." : "Could not update registration check-in.");
      setRegistrations((current) => current.map((item) => item.id === result.id ? result : item));
    } catch (error) { onNotice(error instanceof Error ? error.message : "Could not update registration check-in."); }
  }

  async function manageRegistration(registration: ManageableEventRegistration, action: "cancel" | "promote") {
    if (!checkInEvent) return;
    if (action === "cancel" && !window.confirm(translate("events.confirmCancelRegistration").replace("{name}", `${registration.firstName} ${registration.lastName}`))) return;
    try {
      const response = await fetch(`/api/events/${checkInEvent.id}/registrations/${registration.id}/${action}`, {
        method: "PUT", headers: { "x-department-id": departmentId },
      });
      const result = await response.json() as ManageableEventRegistration | { error?: string };
      if (!response.ok || !("id" in result)) throw new Error("error" in result ? result.error ?? "Could not update registration." : "Could not update registration.");
      setRegistrations((current) => current.map((item) => item.id === result.id ? result : item));
      const countChange = action === "cancel" ? (registration.status === "registered" ? -1 : 0) : 1;
      if (countChange) setEvents((current) => current.map((event) => event.id === checkInEvent.id ? { ...event, registrationCount: Math.max(0, (event.registrationCount ?? 0) + countChange) } : event));
      onNotice(translate(action === "cancel" ? "events.registrationCancelled" : "events.registrationPromoted"));
    } catch (error) { onNotice(error instanceof Error ? error.message : "Could not update registration."); }
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
      onNotice(translate("events.followUpSavedFor").replace("{name}", `${followUp.firstName} ${followUp.lastName}`));
    } catch (error) { onNotice(error instanceof Error ? error.message : "Could not save visitor follow-up."); }
    finally { setFollowUpSavingId(""); }
  }

  return (
    <ModuleTranslationHost translations={eventTranslations} language={getActiveLanguage()}>
    <>
      <div className={`demo-notice ${loadError ? "demo-notice-error" : ""}`}>
        <span className="demo-dot" />
        {loadError ? translate("events.unavailable").replace("{error}", loadError) : translate("events.localNotice").replace("{location}", departmentLocation)}
        {loadError && <button className="event-retry" type="button" onClick={() => void loadEvents()}>{translate("events.tryAgain")}</button>}
      </div>

      <section className="page-heading">
        <div>
          <div className="eyebrow">{translate("events.eyebrow")}</div>
          <h1>{translate("events.title")}</h1>
          <p className="page-subtitle">{translate("events.subtitle")}</p>
        </div>
        <div className="event-heading-actions"><button className="button button-secondary" type="button" onClick={() => setIsWorshipLibraryOpen(true)}><Music2 size={16} /> {translate("events.worshipLibrary")}</button>{canManage && <><button className="button button-secondary" type="button" onClick={() => void openVisitorFollowUps()}><ClipboardList size={17} /> {translate("events.visitorFollowups")}</button><button className="button button-secondary" type="button" onClick={() => setQualificationManagerOpen(true)}><Users size={16} /> Volunteer qualifications</button><button className="button button-primary" type="button" onClick={openCreateModal}><Plus size={18} /> {translate("events.addEvent")}</button></>}</div>
      </section>
      <VolunteerAvailability key={departmentId} departmentId={departmentId} csrfToken={csrfToken}
        t={(message) => translateModuleText(message, eventTranslations, getActiveLanguage())} />

      <section className="stat-grid event-stat-grid" aria-label={translate("events.summaryLabel")}>
        <article className="stat-card"><div className="stat-icon stat-icon-green"><CalendarDays size={19} /></div><div className="stat-content"><span>{translate("events.upcoming")}</span><strong>{upcomingEvents.length}</strong><small>{translate("events.fromToday")}</small></div></article>
        <article className="stat-card"><div className="stat-icon stat-icon-blue"><Clock3 size={19} /></div><div className="stat-content"><span>{translate("events.thisMonth")}</span><strong>{thisMonthCount}</strong><small>{translate("events.stillToCome")}</small></div></article>
        <article className="stat-card event-next-card"><div className="stat-icon stat-icon-amber"><MapPin size={19} /></div><div className="stat-content"><span>{translate("events.nextGathering")}</span><strong className="event-next-title">{upcomingEvents[0]?.title ?? translate("events.nothingPlanned")}</strong><small>{upcomingEvents[0] ? `${formatEventDate(upcomingEvents[0].eventDate)} · ${eventTimeLabel(upcomingEvents[0])}` : translate("events.addFirst")}</small></div></article>
        {canManage && <button className="stat-card stat-card-action event-create-card" type="button" onClick={openCreateModal}><span className="import-icon"><Plus size={19} /></span><span className="stat-content"><span>{translate("events.planningAhead")}</span><strong className="stat-action-title">{translate("events.scheduleGathering")}</strong><small>{translate("events.forCommunity")}</small></span><span className="card-arrow">↗</span></button>}
      </section>

      <section className="directory-card">
        <div className="directory-heading"><div><h2>{translate("events.schedule")}</h2><p>{translate("events.scheduleDescription")}</p></div></div>
        <div className="directory-toolbar event-toolbar">
          <div className="search-field"><Search size={17} /><input aria-label={translate("events.searchLabel")} placeholder={translate("events.searchPlaceholder")} value={query} onChange={(event) => setQuery(event.target.value)} /></div>{canManage && (scheduleView === "list" || scheduleView === "workload" || scheduleView === "roster") && <label className="event-role-category-filter">Role category<select aria-label="Filter duty roster by role category" value={roleCategoryFilter} onChange={(event) => setRoleCategoryFilter(event.target.value)}><option value="">All role categories</option>{roleCategoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}{hasUncategorizedRoles && <option value={UNCATEGORIZED_ROLE_FILTER}>Uncategorized</option>}</select></label>}
          {scheduleView !== "attendance" && <div className="filter-tabs" role="tablist" aria-label={translate("events.filterSchedule")}>
            <button className={filter === "upcoming" ? "filter-tab filter-tab-active" : "filter-tab"} type="button" role="tab" aria-selected={filter === "upcoming"} onClick={() => setFilter("upcoming")}>{translate("events.upcomingTab")} <span>{upcomingEvents.length}</span></button>
            <button className={filter === "all" ? "filter-tab filter-tab-active" : "filter-tab"} type="button" role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>{translate("events.allTab")} <span>{events.length}</span></button>
            <button className={filter === "past" ? "filter-tab filter-tab-active" : "filter-tab"} type="button" role="tab" aria-selected={filter === "past"} onClick={() => setFilter("past")}>{translate("events.pastTab")} <span>{events.filter((event) => event.eventDate < today).length}</span></button>
          </div>}
          <div className="schedule-view-toggle" role="group" aria-label={translate("events.scheduleView")}>
            <button className={scheduleView === "list" ? "is-active" : ""} type="button" aria-pressed={scheduleView === "list"} onClick={() => setScheduleView("list")}>{translate("events.listView")}</button>
            <button className={scheduleView === "month" ? "is-active" : ""} type="button" aria-pressed={scheduleView === "month"} onClick={() => setScheduleView("month")}>{translate("events.monthView")}</button>
            <button className={scheduleView === "attendance" ? "is-active" : ""} type="button" aria-pressed={scheduleView === "attendance"} onClick={() => setScheduleView("attendance")}>{translate("events.attendanceReport")}</button>
            {canManage && <button className={scheduleView === "roster" ? "is-active" : ""} type="button" aria-pressed={scheduleView === "roster"} onClick={() => setScheduleView("roster")}>Roster matrix</button>}
            {canManage && <button className={scheduleView === "workload" ? "is-active" : ""} type="button" aria-pressed={scheduleView === "workload"} onClick={() => setScheduleView("workload")}>Workload</button>}
          </div>
          {(scheduleView === "list" || scheduleView === "roster") && <label className="event-role-category-filter">Staffing<select value={!canManage && staffingFilter === "unfilled" ? "all" : staffingFilter} onChange={(event) => setStaffingFilter(event.target.value as typeof staffingFilter)}><option value="all">All roles</option><option value="mine">My assignments</option><option value="requested">My pending requests</option>{canManage && <option value="unfilled">Unfilled roles only</option>}</select></label>}
          {canManage && (scheduleView === "list" || scheduleView === "workload" || scheduleView === "roster") && <label className="event-role-category-filter">Responsible person<select value={responsibleFilter} onChange={(change) => setResponsibleFilter(change.target.value)}><option value="">Anyone</option><option value="unassigned">No responsible person</option>{responsibleContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.firstName} {contact.lastName}</option>)}</select></label>}
          {showMyDuties && scheduleView === "list" && <OwnDutyExports rows={ownDutyRows} departmentLocation={departmentLocation} pendingOnly={showMyRequests} onNotice={onNotice} />}
          {canManage && scheduleView === "list" && <><button className="button button-secondary" type="button" onClick={downloadStaffingReport} disabled={!dutyRosterEvents.some((event) => (event.positions ?? []).some(dutyPositionMatches))}><Download size={15} />Export staffing</button><button className="button button-secondary" type="button" onClick={printStaffingReport} disabled={!dutyRosterEvents.some((event) => (event.positions ?? []).some(dutyPositionMatches))}><Printer size={15} />Print staffing</button></>}
        </div>

        {scheduleView === "roster" && canManage ? (!staffingMatrix || isLoading || loadError ? <p className="empty-state">{loadError ? translate("events.scheduleLoadFailed") : translate("events.loading")}</p> : <StaffingRosterMatrix matrix={staffingMatrix} location={departmentLocation} onOpenEvent={setDetailsEvent} onNotice={onNotice} />) : scheduleView === "workload" && canManage ? (isLoading || loadError ? <p className="empty-state">{isLoading ? translate("events.loading") : translate("events.scheduleLoadFailed")}</p> : <VolunteerWorkload events={matchingResponsibleEvents} contacts={contacts} matchesCategory={roleCategoryMatches} onOpenEvent={setDetailsEvent} />) : scheduleView === "attendance" ? <div className="attendance-report">
          <div className="attendance-report-heading">
            <div>
              <div className="form-row">
                <label>Attendance from<input type="date" value={attendanceFrom} onChange={(event) => setAttendanceFrom(event.target.value)} /></label>
                <label>Attendance through<input type="date" value={attendanceTo} onChange={(event) => setAttendanceTo(event.target.value)} /></label>
              </div>
              {attendanceDatesInvalid ? <p role="alert">The start date must be on or before the end date.</p> : <>
                <p>{translate("events.attendanceReportSummary").replace("{gatherings}", String(attendanceEvents.length)).replace("{visits}", String(attendanceCounts.adults + attendanceCounts.children))} · {translate("events.adults")}: {attendanceCounts.adults} · {translate("events.children")}: {attendanceCounts.children}</p>
                {priorAttendanceEvents && !isLoading && !loadError && <p>
                  Previous year ({formatEventDate(priorFrom)} – {formatEventDate(priorTo)}): {priorAttendanceCounts
                    ? translate("events.attendanceReportSummary").replace("{gatherings}", String(priorAttendanceEvents.length)).replace("{visits}", String(priorAttendanceCounts.adults + priorAttendanceCounts.children))
                    : "No attendance recorded."}
                </p>}
              </>}
            </div>
            <button className="button button-secondary" type="button" onClick={downloadAttendanceReport} disabled={attendanceEvents.length === 0}><Download size={15} />{translate("events.exportAttendance")}</button>
          </div>
          <div className="table-scroll"><table className="people-table event-table attendance-report-table"><thead><tr><th>{translate("events.date")}</th><th>{translate("events.gathering")}</th><th>{translate("events.type")}</th><th>{translate("events.adults")}</th><th>{translate("events.children")}</th><th>{translate("events.total")}</th><th>{translate("events.recordedAt")}</th></tr></thead><tbody>
            {attendanceEvents.map((event) => <tr key={event.id}><td>{formatEventDate(event.eventDate)}</td><td>{event.title}</td><td>{eventKindLabel(event.kind)}</td><td>{event.attendanceAdults ?? 0}</td><td>{event.attendanceChildren ?? 0}</td><td>{(event.attendanceAdults ?? 0) + (event.attendanceChildren ?? 0)}</td><td>{event.attendanceRecordedAt ? formatUserDate(event.attendanceRecordedAt, true) : "—"}</td></tr>)}
            {attendanceEvents.length === 0 && <tr><td colSpan={7} className="empty-state">{isLoading ? translate("events.loading") : translate("events.attendanceReportEmpty")}</td></tr>}
          </tbody></table></div>
        </div> : scheduleView === "month" ? <div className="schedule-calendar" aria-label={translate("events.calendarLabel")}>
          <div className="schedule-calendar-toolbar"><div><strong>{new Intl.DateTimeFormat(document.documentElement.lang || "en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${calendarMonth}-01T12:00:00Z`))}</strong><span>{translate("events.gatheringCount").replace("{count}", String(filteredEvents.filter((event) => event.eventDate.startsWith(calendarMonth)).length))}</span></div><div><button className="community-row-action" type="button" aria-label={translate("events.previousMonth")} onClick={() => moveCalendarMonth(-1)}><ArrowLeft size={16} /></button><button className="button button-secondary" type="button" onClick={() => { setCalendarMonth(today.slice(0, 7)); }}>{translate("events.today")}</button><button className="community-row-action" type="button" aria-label={translate("events.nextMonth")} onClick={() => moveCalendarMonth(1)}><ArrowRight size={16} /></button></div></div>
          <div className="schedule-calendar-grid" role="grid" aria-label={translate("events.calendarDates")}><div className="schedule-calendar-weekdays" role="row">{["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-06", "2024-01-07"].map((date) => { const day = new Intl.DateTimeFormat(document.documentElement.lang || "en", { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)); return <span role="columnheader" key={date}>{day}</span>; })}</div><div className="schedule-calendar-days">{calendarDays.map((day) => {
            const dayEvents = filteredEvents.filter((event) => event.eventDate === day.date);
            return <article className={`schedule-calendar-day${day.inMonth ? "" : " is-outside"}${day.date === today ? " is-today" : ""}`} role="gridcell" key={day.date}><time dateTime={day.date}>{Number(day.date.slice(-2))}</time>{dayEvents.map((event) => <button className={`schedule-calendar-event event-kind-${event.kind}`} type="button" key={event.id} onClick={() => setDetailsEvent(event)} title={`${eventTimeLabel(event)} · ${event.title}`}>{eventTimeLabel(event)} {event.title}</button>)}</article>;
          })}</div></div>

          {filteredEvents.filter((event) => event.eventDate.startsWith(calendarMonth)).length === 0 && <p className="empty-state schedule-calendar-empty">{translate("events.emptyMonth")}</p>}
        </div> : <div className="table-scroll"><table className="people-table event-table"><thead><tr><th>{translate("events.date")}</th><th>{translate("events.gathering")}</th><th>{translate("events.time")}</th><th>{translate("events.location")}</th><th>{translate("events.type")}</th><th><span className="sr-only">{translate("events.actions")}</span></th></tr></thead><tbody>
          {dutyRosterEvents.map((event) => {
            const date = formatShortDate(event.eventDate);
            const visiblePositions = (event.positions ?? []).map((position, index) => ({ position, index })).filter(({ position }) => dutyPositionMatches(position));
            return <tr key={event.id} className="event-clickable-row" onClick={(clickEvent) => { if (clickEvent.target instanceof Element && clickEvent.target.closest("button, a, input, select, textarea")) return; setDetailsEvent(event); }}><td><div className="event-date-badge"><strong>{date.day}</strong><span>{date.month}</span></div></td><td><div className="event-name-cell"><button className="event-name-trigger" type="button" onClick={() => setDetailsEvent(event)}>{event.title}</button>{event.cancelledAt && <small className="event-cancelled-badge">Cancelled · {event.cancellationReason}</small>}{event.seriesId && <small className="event-series-badge"><Repeat2 size={11} />{translate("events.recurring")}</small>}{event.importedFrom && <small>{translate("events.importedReadOnly")}</small>}{event.description && <small>{event.description}</small>}<small className="event-attendance-summary">{event.attendanceRecordedAt ? translate("events.attendance").replace("{adults}", String(event.attendanceAdults ?? 0)).replace("{children}", String(event.attendanceChildren ?? 0)) : translate("events.attendanceNotRecorded")}</small>{event.registrationEnabled && <small className="event-registration-summary">{translate("events.registration").replace("{count}", String(event.registrationCount ?? 0))}{event.registrationCapacity ? ` / ${event.registrationCapacity}` : ` ${translate("events.registered")}`}{event.registrationCapacity && (event.registrationCount ?? 0) >= event.registrationCapacity ? translate("events.waitlistOpen") : ""}</small>}{Boolean(event.positions?.length) && <div className="event-position-list">{visiblePositions.map(({ position, index }) => { const person = contacts.find((contact) => contact.id === position.contactId); const responseLabel = position.responseStatus === "accepted" ? translate("events.accepted") : position.responseStatus === "declined" ? translate("events.declined") : position.contactId ? translate("events.awaitingResponse") : translate("events.unassigned"); return <div className="event-position-row" key={index}><small>{position.name}: {person ? `${person.firstName} ${person.lastName}` : translate("events.unassigned")} · {responseLabel}</small>{position.canRespond && !event.cancelledAt && <select aria-label={translate("events.positionResponse").replace("{position}", position.name)} value={position.responseStatus ?? "pending"} onChange={(change) => void respondToPosition(event, index, change.target.value as "pending" | "accepted" | "declined")}><option value="pending">{translate("events.chooseResponse")}</option><option value="accepted">{translate("events.accept")}</option><option value="declined">{translate("events.decline")}</option></select>}</div>; })}</div>}{!showUnfilledRoles && <EventPositionSwapControls event={event} contacts={contacts} swaps={positionSwaps} selectedTargets={swapTargetByPosition} onSelectTarget={(positionIndex, targetIndex) => setSwapTargetByPosition((current) => ({ ...current, [`${event.id}:${positionIndex}`]: targetIndex }))} onRequest={(positionIndex, targetIndex) => void requestPositionSwap(event, positionIndex, targetIndex)} onRespond={(swap, decision) => void respondToPositionSwap(swap, decision)} categoryFilter={roleCategoryFilter} />}<EventBulkRoleAssignment event={event} rosterEvents={events} contacts={contacts} qualifications={volunteerQualifications} canManage={canManage} departmentId={departmentId} categoryFilter={roleCategoryFilter} onAssigned={() => void loadEvents()} />{Boolean(event.timePlan?.length) && <small>{translate("events.timePlan")}: {event.timePlan!.map((item) => (item.startTime ? item.startTime + " " : "") + item.title + (item.position ? ` · ${translate("events.responsiblePosition")}: ${item.position}` : "") + (item.durationMinutes ? ` (${item.durationMinutes} ${translate("events.minuteSuffix")})` : "")).join(" → ")}</small>}{event.timePlan?.map((item, index) => { const song = worshipSongs.find((candidate) => candidate.id === item.songId); if (!song) return null; const arrangement = song.arrangements.find((candidate) => candidate.id === item.arrangementId); return <small className="event-song-links" key={`${event.id}-${item.songId}-${index}`}>{[song.title, arrangement?.name, song.bpm && `${song.bpm} BPM`, song.timeSignature].filter(Boolean).join(" · ")}{arrangement?.chartUrl && <> · <a href={arrangement.chartUrl} target="_blank" rel="noreferrer">{translate("events.chartLink")}</a></>}{arrangement?.audioUrl && <> · <a href={arrangement.audioUrl} target="_blank" rel="noreferrer">{translate("events.audioLink")}</a></>}</small>; })}{Boolean(event.assetIds?.length) && <small>{translate("events.assets").replace("{assets}", resources.filter((resource) => event.assetIds!.includes(resource.id)).map((resource) => resource.name).join(", "))}</small>}</div></td><td className="event-time-cell">{eventTimeLabel(event)}</td><td><span className="event-location-cell"><MapPin size={13} />{event.location}{event.room ? " · " + event.room : ""}</span></td><td><span className={`event-kind event-kind-${event.kind}`}>{eventKindLabel(event.kind)}</span></td><td>{canManage && !event.importedFrom && <div className="event-actions">{event.registrationEnabled && <button className="event-action" type="button" aria-label={`${translate("events.copyRegistration")}: ${event.title}`} title={translate("events.copyRegistration")} onClick={() => void copyRegistrationLink(event)}><Link2 size={15} /></button>}<button className="event-action" type="button" aria-label={`${translate("events.checkIn")}: ${event.title}`} title={translate("events.checkIn")} onClick={() => void openCheckIns(event)}><UserCheck size={15} /></button><button className="event-action" type="button" aria-label={`${translate("events.recordAttendance")}: ${event.title}`} title={translate("events.recordAttendance")} onClick={() => openAttendance(event)}><Users size={15} /></button><button className="event-action" type="button" aria-label={translate("events.editEvent").replace("{title}", event.title)} onClick={() => openEditModal(event)}><Pencil size={15} /></button><button className="event-action event-delete-action" type="button" aria-label={translate("events.deleteEvent").replace("{title}", event.title)} onClick={() => void deleteEvent(event)}><Trash2 size={15} /></button>{event.seriesId && <button className="event-action event-series-delete" type="button" aria-label={translate("events.deleteSeriesFor").replace("{title}", event.title)} title={translate("events.deleteSeries")} onClick={() => void deleteEvent(event, true)}><Repeat2 size={15} /></button>}</div>}</td></tr>;
          })}
          {dutyRosterEvents.length === 0 && <tr><td colSpan={6} className="empty-state">{isLoading ? translate("events.loading") : loadError ? translate("events.scheduleLoadFailed") : showUnfilledRoles ? "No unfilled roles match these filters." : roleCategoryFilter || responsibleFilter ? "No events match these staffing filters." : query ? translate("events.noSearchMatch") : filter === "past" ? translate("events.noPast") : translate("events.noSchedule")}</td></tr>}
        </tbody></table></div>}
        {scheduleView !== "attendance" && scheduleView !== "workload" && scheduleView !== "roster" && <footer className="table-footer"><span>{translate("events.showing").replace("{shown}", String(scheduleView === "list" ? dutyRosterEvents.length : filteredEvents.length)).replace("{total}", String(events.length))}</span><span className="event-footer-note">{translate("events.timeZone").replace("{timeZone}", departmentTimeZone)}</span></footer>}
      </section>

      <footer className="page-footer"><span>{translate("events.footer")}</span><span>© 2026 Smart Church</span></footer>
      {qualificationManagerOpen && canManage && <VolunteerQualificationSettings departmentId={departmentId} contacts={contacts} qualifications={volunteerQualifications} onChanged={() => loadVolunteerQualifications()} onClose={() => setQualificationManagerOpen(false)} />}{isWorshipLibraryOpen && <WorshipPlanning departmentId={departmentId} canManage={canManage} onClose={() => setIsWorshipLibraryOpen(false)} onChanged={() => void refreshWorshipLibrary()} onNotice={onNotice} selectedSongId={linkedSongNavigation?.id} directorySearch={songSearchNavigation} selectedSongRequestId={linkedSongNavigation?.requestId} onSelectedSongHandled={(requestId) => onLinkedSongHandled?.(requestId)} />}

      {detailsEvent && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDetailsEvent(null)}><section className="modal event-details-modal" role="dialog" aria-modal="true" aria-labelledby="event-details-title"><div className="modal-heading"><div><span className={`event-kind event-kind-${detailsEvent.kind}`}>{eventKindLabel(detailsEvent.kind)}</span><h2 id="event-details-title">{detailsEvent.title}</h2>{detailsEvent.cancelledAt && <span className="event-cancelled-badge">Cancelled</span>}</div><button className="icon-button" type="button" aria-label={translate("events.closeDialog")} onClick={() => setDetailsEvent(null)}><X size={19} /></button></div><dl className="event-details-grid"><div><dt>{translate("events.date")}</dt><dd>{formatEventDate(detailsEvent.eventDate)}</dd></div><div><dt>{translate("events.time")}</dt><dd>{eventTimeLabel(detailsEvent)}</dd></div><div><dt>{translate("events.location")}</dt><dd>{detailsEvent.location}{detailsEvent.room ? ` · ${detailsEvent.room}` : ""}</dd></div>{responsibleName(detailsEvent) && <div><dt>Responsible person</dt><dd>{responsibleName(detailsEvent)}</dd></div>}</dl>{canManage && !detailsEvent.cancelledAt && <EventVolunteerAvailabilityWarning key={`${departmentId}:${detailsEvent.id}`} departmentId={departmentId} eventId={detailsEvent.id} t={(message) => translateModuleText(message, eventTranslations, getActiveLanguage())} />}{canManage && <ServiceEventFactsPanel key={"facts:" + departmentId + ":" + detailsEvent.id} departmentId={departmentId} csrfToken={csrfToken} eventId={detailsEvent.id} eventDate={detailsEvent.eventDate} />}{detailsEvent.cancelledAt && <p className="event-details-summary"><strong>Cancelled</strong> · {detailsEvent.cancellationReason || "No reason provided"} · {new Date(detailsEvent.cancelledAt).toLocaleString()}{detailsEvent.cancelledBy ? ` · by ${detailsEvent.cancelledBy}` : ""}</p>}{detailsEvent.description && <p className="event-details-description">{detailsEvent.description}</p>}{detailsEvent.registrationEnabled && <p className="event-details-summary">{translate("events.registration").replace("{count}", String(detailsEvent.registrationCount ?? 0))}{detailsEvent.registrationCapacity ? ` / ${detailsEvent.registrationCapacity}` : ` ${translate("events.registered")}`}{detailsEvent.registrationCapacity && (detailsEvent.registrationCount ?? 0) >= detailsEvent.registrationCapacity ? translate("events.waitlistOpen") : ""}</p>}{detailsEvent.attendanceRecordedAt && <p className="event-details-summary">{translate("events.attendance").replace("{adults}", String(detailsEvent.attendanceAdults ?? 0)).replace("{children}", String(detailsEvent.attendanceChildren ?? 0))}</p>}{Boolean(detailsEvent.positions?.length) && <section className="event-details-section"><h3>{translate("events.positions")}</h3><ul>{detailsEvent.positions!.map((position, index) => { const person = contacts.find((contact) => contact.id === position.contactId); return <li key={`${position.name}-${index}`}><strong>{position.name}</strong><span>{person ? `${person.firstName} ${person.lastName}` : translate("events.unassigned")}</span></li>; })}</ul></section>}<EventPositionStaffNotes event={detailsEvent} departmentId={departmentId} canManage={canManage} />{Boolean(detailsEvent.timePlan?.length) && <section className="event-details-section"><div className="service-planning-heading"><h3>{translate("events.timePlan")}</h3><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => void copyServicePlanLink(detailsEvent.id)}><Link2 size={15} />Copy plan link</button><button className="button button-secondary" type="button" onClick={() => printRunSheet(detailsEvent)}><Printer size={15} />Print run sheet</button></div></div><ul>{detailsEvent.timePlan!.map((item, index) => { const song = worshipSongs.find((candidate) => candidate.id === item.songId); const arrangement = song?.arrangements.find((candidate) => candidate.id === item.arrangementId); const section = servicePlanSectionHeading(detailsEvent.timePlan!, index); return <Fragment key={`${item.title}-${index}`}>{section && <li className="event-details-plan-section"><strong>{section}</strong></li>}<li><span className="event-details-plan-time">{item.startTime ?? ""}</span><div><strong>{item.title}</strong>{item.position && <span>{translate("events.responsiblePosition")}: {item.position}</span>}{item.durationMinutes && <span>{item.durationMinutes} {translate("events.minuteSuffix")}</span>}{song && <span>{[song.title, arrangement?.name, song.bpm && `${song.bpm} BPM`, song.timeSignature].filter(Boolean).join(" · ")}</span>}</div></li></Fragment>; })}</ul></section>}{Boolean(detailsEvent.assetIds?.length) && <p className="event-details-summary">{translate("events.assets").replace("{assets}", resources.filter((resource) => detailsEvent.assetIds!.includes(resource.id)).map((resource) => resource.name).join(", "))}</p>}<div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setDetailsEvent(null)}>{translate("events.close")}</button>{canManage && !detailsEvent.importedFrom && <button className="button button-primary" type="button" onClick={() => { const event = detailsEvent; setDetailsEvent(null); openEditModal(event); }}><Pencil size={14} />{translate("events.editEvent").replace("{title}", detailsEvent.title)}</button>}{canManage && !detailsEvent.importedFrom && <button className="button button-secondary" type="button" onClick={() => void updateEventCancellation(detailsEvent, detailsEvent.cancelledAt ? "restore" : "cancel")}>{detailsEvent.cancelledAt ? "Restore event" : "Cancel event"}</button>}</div></section></div>}      {isModalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setIsModalOpen(false)}><section className="modal event-modal" role="dialog" aria-modal="true" aria-labelledby="event-modal-title"><div className="modal-heading"><div><span className="eyebrow">{translate("events.scheduleFormEyebrow")}</span><h2 id="event-modal-title">{translate(editingEvent ? "events.editGathering" : "events.addGathering")}</h2><p>{translate("events.gatheringFormHelp")}</p></div><button className="icon-button" type="button" aria-label={translate("events.closeDialog")} onClick={() => setIsModalOpen(false)}><X size={19} /></button></div><form key={editingEvent?.id ?? "new-event"} onSubmit={saveEvent}>{servicePlanTemplates.length > 0 && <label className="event-plan-template-select">{translate("events.planTemplate")}<select value={selectedPlanTemplateId} onChange={(event) => applyServicePlanTemplate(event.target.value)}><option value="">{translate("events.chooseTemplate")}</option>{servicePlanTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select><small>{translate("events.selectPlanTemplate")}</small></label>}
        <label>{translate("events.titleField")}<input name="title" autoFocus required maxLength={160} defaultValue={editingEvent?.title ?? ""} placeholder={translate("events.titlePlaceholder")} /></label>
        <div className="form-row"><label>{translate("events.typeField")}<select name="kind" defaultValue={editingEvent?.kind ?? "service"}>{eventKinds.map((kind) => <option value={kind.value} key={kind.value}>{translate(kind.label)}</option>)}</select></label><label>{translate("events.locationBuilding")}<input name="location" required maxLength={160} defaultValue={editingEvent?.location ?? departmentLocation} placeholder={translate("events.locationPlaceholder")} /></label><label>{translate("events.roomField")}<input maxLength={160} value={room} onChange={(event) => setRoom(event.target.value)} placeholder={translate("events.roomPlaceholder")} /></label></div>
        <label>Responsible person<select name="responsibleContactId" defaultValue={editingEvent?.responsibleContactId ?? ""}><option value="">None</option>{contacts.filter((contact) => !contact.archivedAt || contact.id === editingEvent?.responsibleContactId).map((contact) => <option key={contact.id} value={contact.id}>{contact.firstName} {contact.lastName}</option>)}</select></label>
        <div className="form-row event-time-row"><label>{translate("events.dateField")}<input type="date" name="eventDate" required defaultValue={editingEvent?.eventDate ?? departmentDateString(departmentTimeZone)} /></label>{!isAllDay && <><label>{translate("events.startsAt")}<input type="time" name="startTime" required defaultValue={editingEvent?.startTime ?? "10:00"} /></label><label>{translate("events.endsAt")} <span className="optional-label">{translate("events.optional")}</span><input type="time" name="endTime" defaultValue={editingEvent?.endTime ?? ""} /></label></>}</div>
        <label className="event-all-day-toggle"><input type="checkbox" name="isAllDay" checked={isAllDay} onChange={(event) => setIsAllDay(event.target.checked)} />{translate("events.allDay")}</label>
        <label>{translate("events.descriptionField")} <span className="optional-label">{translate("events.optional")}</span><textarea name="description" maxLength={2000} rows={3} defaultValue={editingEvent?.description ?? ""} placeholder={translate("events.descriptionPlaceholder")} /></label>
        <section className="service-planning-section event-registration-settings"><div className="service-planning-heading"><div><h3>{translate("events.publicRegistrationTitle")}</h3><p>{translate("events.publicRegistrationHelp")}</p></div></div><label className="event-registration-toggle"><input type="checkbox" name="registrationEnabled" defaultChecked={editingEvent?.registrationEnabled ?? false} /><span>{translate("events.allowRegistration")}</span></label><label>{translate("events.capacity")} <span className="optional-label">{translate("events.capacityOptional")}</span><input type="number" name="registrationCapacity" min="1" max="100000" step="1" defaultValue={editingEvent?.registrationCapacity ?? ""} placeholder={translate("events.noLimit")} /></label>{editingEvent?.registrationToken && <p className="event-registration-existing-link">{translate("events.currentRegistrationLink")}: <code>{window.location.origin}/register/{editingEvent.registrationToken}</code></p>}</section>
        {!editingEvent && <section className="event-recurrence-controls"><label>{translate("events.repeat")}<select name="recurrence" value={recurrenceInterval} onChange={(event) => setRecurrenceInterval(event.target.value as typeof recurrenceInterval)}><option value="">{translate("events.doesNotRepeat")}</option><option value="weekly">{translate("events.everyWeek")}</option><option value="biweekly">{translate("events.everyTwoWeeks")}</option><option value="monthly">{translate("events.everyMonth")}</option></select></label>{recurrenceInterval && <label>{translate("events.repeatUntil")}<input type="date" name="recurrenceEndDate" required min={departmentDateString(departmentTimeZone)} defaultValue={new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)} /></label>}<p>{translate("events.recurrenceHelp")}</p></section>}
        {editingEvent?.seriesId && <label className="event-series-update"><input type="checkbox" checked={applyToSeries} onChange={(event) => setApplyToSeries(event.target.checked)} /><span>Apply these changes to all {events.filter((item) => item.seriesId === editingEvent.seriesId).length} gatherings in this series</span></label>}
        <section className="service-planning-section"><div className="service-planning-heading"><div><h3>{translate("events.assetsHeading")}</h3><p>{translate("events.assetsDescription")}</p></div></div>{resources.length ? <div className="service-asset-list">{resources.map((resource) => <label key={resource.id}><input type="checkbox" checked={assetIds.includes(resource.id)} onChange={(event) => setAssetIds((current) => event.target.checked ? [...current, resource.id] : current.filter((id) => id !== resource.id))} /><span>{resource.name}<small>{resource.category}{resource.location ? " · " + resource.location : ""}</small></span></label>)}</div> : <p className="service-planning-empty">{translate("events.noAssets")}</p>}</section>
        <section className="service-planning-section"><div className="service-planning-heading"><div><h3>{translate("events.positionsHeading")}</h3><p>{translate("events.positionsDescription")}</p></div><button className="button button-secondary" type="button" onClick={() => setPositions((current) => [...current, { name: "" }])}><Plus size={14} />{translate("events.addPosition")}</button></div>{positions.length ? <div className="service-position-list">{positions.map((position, index) => <div className="service-position-row" key={index}><input aria-label={translate("events.positionNamePlaceholder")} required placeholder={translate("events.positionNamePlaceholder")} value={position.name} onChange={(event) => updateEventPosition(index, event.target.value)} /><input aria-label="Role category" maxLength={80} placeholder="Optional category" value={position.category ?? ""} onChange={(event) => setPositions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, category: event.target.value } : item))} />{volunteerQualifications.filter((item) => item.active).length > 0 && <select aria-label={`Required qualifications for ${position.name || "this role"}`} multiple value={position.qualificationIds ?? []} onChange={(event) => { const qualificationIds = Array.from(event.currentTarget.selectedOptions, (option) => option.value); setPositions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, qualificationIds } : item)); }}>{volunteerQualifications.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.category} · {item.name}</option>)}</select>}<select aria-label={translate("events.assignedPerson")} value={position.contactId ?? ""} onChange={(event) => setPositions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, contactId: event.target.value || undefined } : item))}><option value="">{translate("events.unassignedPerson")}</option>{contacts.filter((person) => person.id === position.contactId || hasQualifications(person.id, position.qualificationIds ?? [], volunteerQualifications)).map((person) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName}{position.contactId === person.id && !hasQualifications(person.id, position.qualificationIds ?? [], volunteerQualifications) ? " · missing required qualification" : ""}</option>)}</select><button className="community-row-action community-row-delete" type="button" aria-label={translate("events.remove")} onClick={() => removeEventPosition(index)}><Trash2 size={15} /></button></div>)}</div> : <p className="service-planning-empty">{translate("events.noPositions")}</p>}</section>
        <section className="service-planning-section"><div className="service-planning-heading"><div><h3>{translate("events.timePlan")}</h3><p>{translate("events.timePlanDescription")}</p></div><button className="button button-secondary" type="button" onClick={() => setTimePlan((current) => [...current, { title: "" }])}><Plus size={14} />{translate("events.addPlanItemLabel")}</button></div>{timePlan.length ? <div className="service-timeplan-list">{timePlan.map((item, index) => <div className="service-timeplan-row" key={index}><input className="service-timeplan-notes" aria-label="Section (optional)" placeholder="Section (optional)" maxLength={80} value={item.section ?? ""} onChange={(event) => setTimePlan((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, section: event.target.value } : entry))} /><select aria-label={translate("events.chooseSong")} value={item.songId ?? ""} onChange={(event) => { const song = worshipSongs.find((candidate) => candidate.id === event.target.value); setTimePlan((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, songId: song?.id, arrangementId: undefined, title: song?.title ?? entry.title } : entry)); }}><option value="">{translate("events.noSong")}</option>{worshipSongs.map((song) => <option key={song.id} value={song.id}>{song.title}</option>)}</select>{item.songId && <select aria-label={translate("events.arrangement")} value={item.arrangementId ?? ""} onChange={(event) => setTimePlan((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, arrangementId: event.target.value || undefined } : entry))}><option value="">{translate("events.noSong")}</option>{worshipSongs.find((song) => song.id === item.songId)?.arrangements.filter((arrangement) => arrangement.active).map((arrangement) => <option key={arrangement.id} value={arrangement.id}>{arrangement.name}{arrangement.key ? ` · ${arrangement.key}` : ""}</option>)}</select>}<select aria-label={translate("events.responsiblePosition")} value={item.position ?? ""} onChange={(event) => setTimePlan((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, position: event.target.value || undefined } : entry))}><option value="">{translate("events.noPosition")}</option>{positions.filter((position) => position.name.trim()).map((position, positionIndex) => <option key={positionIndex} value={position.name}>{position.name}</option>)}</select><input aria-label={translate("events.timePlanItemLabel")} required placeholder={translate("events.timePlanItemLabel")} value={item.title} onChange={(event) => setTimePlan((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, title: event.target.value } : entry))} /><input aria-label={translate("events.startTime")} type="time" value={item.startTime ?? ""} onChange={(event) => setTimePlan((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, startTime: event.target.value || undefined } : entry))} /><input aria-label={translate("events.durationInMinutes")} type="number" min="1" max="1440" placeholder={translate("events.minutes")} value={item.durationMinutes ?? ""} onChange={(event) => setTimePlan((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, durationMinutes: event.target.value ? Number(event.target.value) : undefined } : entry))} /><div className="service-timeplan-order"><button className="community-row-action" type="button" aria-label={translate("events.moveItemUp")} disabled={index === 0} onClick={() => setTimePlan((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}><ArrowUp size={14} /></button><button className="community-row-action" type="button" aria-label={translate("events.moveItemDown")} disabled={index === timePlan.length - 1} onClick={() => setTimePlan((current) => { const next = [...current]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next; })}><ArrowDown size={14} /></button><button className="community-row-action community-row-delete" type="button" aria-label={translate("events.removeTimePlanItem")} onClick={() => setTimePlan((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></button></div><input className="service-timeplan-notes" aria-label={translate("events.timePlanNotes")} placeholder={`${translate("events.itemNotes")} (${translate("events.optional").toLowerCase()})`} value={item.notes ?? ""} onChange={(event) => setTimePlan((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, notes: event.target.value } : entry))} /></div>)}</div> : <p className="service-planning-empty">{translate("events.buildTimePlan")}</p>}</section>
        <div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setIsModalOpen(false)}>{translate("events.cancel")}</button><button className="button button-primary" type="submit" disabled={isSaving}><Check size={16} /> {isSaving ? translate("events.saving") : translate(editingEvent ? "events.saveChanges" : "events.addToSchedule")}</button></div>
      </form></section></div>}
      {attendanceEvent && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setAttendanceEvent(null)}><section className="modal attendance-modal" role="dialog" aria-modal="true" aria-labelledby="attendance-modal-title"><div className="modal-heading"><div><span className="eyebrow">{translate("events.serviceRecord")}</span><h2 id="attendance-modal-title">{translate("events.recordAttendanceTitle")}</h2><p>{attendanceEvent.title} · {formatEventDate(attendanceEvent.eventDate)}</p></div><button className="icon-button" type="button" aria-label={translate("events.closeDialog")} onClick={() => setAttendanceEvent(null)}><X size={19} /></button></div><form onSubmit={(event) => void saveAttendance(event)}><div className="form-row"><label>{translate("events.adults")}<input type="number" min="0" max="100000" step="1" required value={attendanceAdults} onChange={(event) => setAttendanceAdults(event.target.value)} /></label><label>{translate("events.children")}<input type="number" min="0" max="100000" step="1" required value={attendanceChildren} onChange={(event) => setAttendanceChildren(event.target.value)} /></label></div><p className="service-planning-empty">{translate("events.attendancePrompt")}</p><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setAttendanceEvent(null)}>{translate("events.cancel")}</button><button className="button button-primary" type="submit" disabled={attendanceSaving}><Check size={16} />{attendanceSaving ? translate("events.savingAttendance") : translate("events.saveAttendance")}</button></div></form></section></div>}
      {checkInEvent && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setCheckInEvent(null)}><section className="modal check-in-modal" role="dialog" aria-modal="true" aria-labelledby="check-in-modal-title"><div className="modal-heading"><div><span className="eyebrow">{translate("events.checkInEyebrow")}</span><h2 id="check-in-modal-title">{translate("events.checkInTitle")}</h2><p>{checkInEvent.title} · {formatEventDate(checkInEvent.eventDate)}</p></div><button className="icon-button" type="button" aria-label={translate("events.closeDialog")} onClick={() => setCheckInEvent(null)}><X size={19} /></button></div><div className="check-in-summary"><strong>{translate("events.checkedInCount").replace("{count}", String(checkIns.length))}</strong><span>{translate("events.firstTimeCount").replace("{count}", String(checkIns.filter((entry) => entry.firstTimeVisitor).length))}</span><span>{translate("events.followUpsNeededCount").replace("{count}", String(checkIns.filter((entry) => entry.followUpStatus === "needed").length))}</span></div><section className="event-registration-roster"><div className="service-planning-heading"><div><h3>{translate("events.eventRegistrations")}</h3><p>{translate("events.registrationCheckInHelp")}</p></div>{registrations.length > 0 && <button className="button button-secondary" type="button" onClick={downloadRegistrationsReport}><Download size={15} />{translate("events.exportRegistrations")}</button>}</div>{registrations.length ? <div className="check-in-list">{groupRegistrations(registrations).map(({ key, attendees }) => <div key={key}>{attendees[0].partyId && <p><strong>Family registration · {attendees.length} attendees</strong></p>}{attendees.map((registration) => <div className="check-in-row" key={registration.id}><label className="check-in-person"><input type="checkbox" checked={Boolean(registration.checkedInAt)} disabled={registration.status !== "registered"} onChange={(change) => void setRegistrationCheckedIn(registration, change.target.checked)} /><span><strong>{registration.firstName} {registration.lastName}</strong><small>{registrationAttendeeRole(registration) && `${registrationAttendeeRole(registration)} · `}{registration.email} · {translate(registration.status === "waitlisted" ? "events.waitlisted" : registration.status === "cancelled" ? "events.cancelled" : "events.registered")}</small></span></label>{registration.checkedInAt && <span className="event-registration-checked">{translate("events.checkedIn")}</span>}{canManage && registration.status !== "cancelled" && <div className="event-registration-actions">{registration.status === "waitlisted" && <button className="community-row-action" type="button" onClick={() => void manageRegistration(registration, "promote")}>{translate("events.promoteRegistration")}</button>}<button className="community-row-action community-row-delete" type="button" disabled={Boolean(registration.checkedInAt)} onClick={() => void manageRegistration(registration, "cancel")}>{translate("events.cancelRegistration")}</button></div>}</div>)}</div>)}</div> : <p className="community-empty">{translate("events.noPublicRegistrations")}</p>}</section><label className="search-field check-in-search"><Search size={16} /><input aria-label={translate("events.searchCheckIns")} placeholder={translate("events.findDirectoryPerson")} value={checkInQuery} onChange={(event) => setCheckInQuery(event.target.value)} /></label>{checkInsLoading ? <p className="community-empty">{translate("events.loadingCheckIns")}</p> : filteredCheckInContacts.length ? <div className="check-in-list">{filteredCheckInContacts.map((person) => { const checkIn = checkIns.find((entry) => entry.contactId === person.id); return <div className="check-in-row" key={person.id}><label className="check-in-person"><input type="checkbox" checked={Boolean(checkIn)} onChange={(event) => void setPersonCheckedIn(person, event.target.checked)} /><span><strong>{person.firstName} {person.lastName}</strong><small>{translate(person.status === "visitor" ? "events.visitor" : "events.member")}</small></span></label>{checkIn && <div className="check-in-controls"><label className="check-in-first-visit"><input type="checkbox" checked={checkIn.firstTimeVisitor} onChange={(event) => void setFirstTimeVisitor(person, event.target.checked)} /><span>{translate("events.firstTime")}</span></label>{checkIn.firstTimeVisitor && <select aria-label={translate("events.checkInFollowUpStatusFor").replace("{name}", `${person.firstName} ${person.lastName}`)} value={checkIn.followUpStatus} onChange={(event) => void setFollowUpStatus(person, event.target.value as ServiceEventCheckIn["followUpStatus"])}><option value="needed">{translate("events.followUpNeeded")}</option><option value="done">{translate("events.followUpComplete")}</option><option value="not_needed">{translate("events.followUpNone")}</option></select>}</div>}</div>; })}</div> : <p className="community-empty">{translate("events.noMatchingPeople")}</p>}<div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setCheckInEvent(null)}>{translate("events.close")}</button></div></section></div>}
      {followUpQueueOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setFollowUpQueueOpen(false)}><section className="modal follow-up-modal" role="dialog" aria-modal="true" aria-labelledby="follow-up-modal-title"><div className="modal-heading"><div><span className="eyebrow">{translate("events.followUpEyebrow")}</span><h2 id="follow-up-modal-title">{translate("events.followUpTitle")}</h2><p>{translate("events.followUpHelp")}</p></div><button className="icon-button" type="button" aria-label={translate("events.closeDialog")} onClick={() => setFollowUpQueueOpen(false)}><X size={19} /></button></div><div className="filter-tabs" role="tablist" aria-label={translate("events.filterFollowUps")}><button className={followUpFilter === "open" ? "filter-tab filter-tab-active" : "filter-tab"} type="button" role="tab" aria-selected={followUpFilter === "open"} onClick={() => setFollowUpFilter("open")}>{translate("events.openFollowUps")} <span>{followUps.filter((item) => item.status === "needed").length}</span></button><button className={followUpFilter === "all" ? "filter-tab filter-tab-active" : "filter-tab"} type="button" role="tab" aria-selected={followUpFilter === "all"} onClick={() => setFollowUpFilter("all")}>{translate("events.allFollowUps")} <span>{followUps.length}</span></button></div>{followUpsLoading ? <p className="community-empty">{translate("events.loadingFollowUps")}</p> : followUps.filter((item) => followUpFilter === "all" || item.status === "needed").length ? <div className="follow-up-list">{followUps.filter((item) => followUpFilter === "all" || item.status === "needed").map((item) => { const rowId = `${item.eventId}:${item.contactId}`; return <form className="follow-up-item" key={rowId} onSubmit={(event) => void saveVisitorFollowUp(event, item)}><div className="follow-up-item-heading"><div><strong>{item.firstName} {item.lastName}</strong><small>{translate("events.firstVisit")} · {formatEventDate(item.eventDate)} · {item.eventTitle}</small></div><select aria-label={translate("events.followUpStatusFor").replace("{name}", `${item.firstName} ${item.lastName}`)} value={item.status} onChange={(event) => setFollowUps((current) => current.map((entry) => `${entry.eventId}:${entry.contactId}` === rowId ? { ...entry, status: event.target.value as VisitorFollowUp["status"] } : entry))}><option value="needed">{translate("events.followUpOpen")}</option><option value="done">{translate("events.followUpCompleted")}</option><option value="not_needed">{translate("events.followUpNone")}</option></select></div><div className="form-row follow-up-fields"><label>{translate("events.assignedTo")}<select value={item.assignedContactId ?? ""} onChange={(event) => setFollowUps((current) => current.map((entry) => `${entry.eventId}:${entry.contactId}` === rowId ? { ...entry, assignedContactId: event.target.value || undefined } : entry))}><option value="">{translate("events.unassignedPerson")}</option>{contacts.filter((person) => person.status === "member").map((person) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>)}</select></label><label>{translate("events.dueDate")}<input type="date" value={item.dueDate ?? ""} onChange={(event) => setFollowUps((current) => current.map((entry) => `${entry.eventId}:${entry.contactId}` === rowId ? { ...entry, dueDate: event.target.value || undefined } : entry))} /></label></div><label>{translate("events.followUpNote")}<textarea rows={2} maxLength={1000} value={item.note} onChange={(event) => setFollowUps((current) => current.map((entry) => `${entry.eventId}:${entry.contactId}` === rowId ? { ...entry, note: event.target.value } : entry))} placeholder={translate("events.followUpNotePlaceholder")} /></label><div className="follow-up-actions"><button className="button button-secondary" type="submit" disabled={followUpSavingId === rowId}><Check size={15} />{followUpSavingId === rowId ? translate("events.saving") : translate("events.saveFollowUp")}</button></div></form>; })}</div> : <p className="community-empty">{followUpFilter === "open" ? translate("events.noOpenFollowUps") : translate("events.noFollowUps")}</p>}<div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setFollowUpQueueOpen(false)}>{translate("events.close")}</button></div></section></div>}
    </>
    </ModuleTranslationHost>
  );
}

