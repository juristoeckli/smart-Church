import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, Plus, Repeat2, RotateCcw, Trash2, X } from "lucide-react";
import type { ModuleContext } from "../../module-registry";
import "./church-calendar.css";

type Scope = "community" | "group" | "personal";
type View = "day" | "week" | "month" | "year" | "list";
type Calendar = { id: string; name: string; scope: Scope; groupId: string | null; groupName?: string; ownerUserId: string | null; color: string; isOwner?: boolean; hasPublicFeed?: boolean };
type Frequency = "daily" | "weekly" | "monthly" | "monthly_weekday" | "yearly" | "manual";
type Recurrence = { frequency: Frequency; interval: number; weekdays: number[]; weekday?: number; weekOfMonth?: number; endsOn?: string; count?: number; dates?: string[] };
type Appointment = {
  appointmentId: string; occurrenceStartAt: string; occurrenceEndAt: string; seriesStartsAt: string; calendarId: string; calendarName: string; calendarScope: Scope;
  groupId?: string | null; title: string; subtitle: string; description: string; allDay: boolean; place: string; url: string;
  internalOnly: boolean; tags: string[]; recurrence: Recurrence | null; linkedEventId: string | null; resourceBookingIds: string[]; canManage: boolean;
  imageUrl?: string | null; signupGroupId?: string | null; signupGroupName?: string | null; signupToken?: string | null; responsibleContactId?: string | null; responsiblePersonName?: string | null;
};
type ArchivedAppointment = { appointmentId: string; title: string; startsAt: string; calendarId: string; calendarName: string; calendarScope: Scope; ownerUserId: string | null };
type ExtraDate = { startsAt: string; endsAt: string };
type ChoiceSet = { groups: Array<{ id: string; name: string }>; signupGroups: Array<{ id: string; name: string; token: string }>; events: Array<{ id: string; title: string; event_date: string }>; resourceBookings: Array<{ id: string; purpose: string; starts_at: string }>; servicePlanTemplates: Array<{ id: string; name: string; positions: Array<{ name: string }> }>; canSelectPeople?: boolean };
type PersonChoice = { id: string; name: string };
type Draft = { calendarId: string; title: string; subtitle: string; description: string; startsAt: string; endsAt: string; allDay: boolean; place: string; url: string; internalOnly: boolean; tags: string; repeat: boolean; frequency: Frequency; interval: number; weekdays: number[]; weekday: number; weekOfMonth: number; endsOn: string; count: string; manualDates: string; linkedEventId: string; resourceBookingIds: string[]; signupGroupId: string; responsibleContactId: string };
const initialDraft = (): Draft => ({ calendarId: "", title: "", subtitle: "", description: "", startsAt: "", endsAt: "", allDay: false, place: "", url: "", internalOnly: false, tags: "", repeat: false, frequency: "weekly", interval: 1, weekdays: [], weekday: 0, weekOfMonth: 1, endsOn: "", count: "", manualDates: "", linkedEventId: "", resourceBookingIds: [], signupGroupId: "", responsibleContactId: "" });
const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");
function dateInput(date: Date) { return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`; }
function dateTimeInput(date: Date) { return `${dateInput(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`; }
function monthlyWeekdayParts(date: Date) { const last = new Date(date); last.setDate(last.getDate() + 7); return { weekday: date.getDay(), weekOfMonth: last.getMonth() !== date.getMonth() ? -1 : Math.floor((date.getDate() - 1) / 7) + 1 }; }
function dateFromLocal(value: string) { return new Date(`${value.slice(0,10)}T00:00:00`); }
function dayLabel(date: Date, language: string) { return new Intl.DateTimeFormat(language === "de" ? "de-CH" : language === "fr" ? "fr-CH" : language === "it" ? "it-CH" : "en-GB", { weekday: "short", day: "numeric", month: "short" }).format(date); }
function monthLabel(date: Date, language: string) { return new Intl.DateTimeFormat(language === "de" ? "de-CH" : language === "fr" ? "fr-CH" : language === "it" ? "it-CH" : "en-GB", { month: "long", year: "numeric" }).format(date); }
function localToIso(value: string) { return value.length === 16 ? `${value}:00` : value; }
function getRange(date: Date, view: View) {
  const start = new Date(date); start.setHours(0,0,0,0);
  const end = new Date(start);
  if (view === "day") end.setDate(end.getDate()+1);
  else if (view === "week") { start.setDate(start.getDate()-((start.getDay()+6)%7)); end.setTime(start.getTime()); end.setDate(end.getDate()+7); }
  else if (view === "month") { start.setDate(1); start.setDate(start.getDate()-((start.getDay()+6)%7)); end.setTime(start.getTime()); end.setDate(end.getDate()+42); }
  else if (view === "year") { start.setMonth(0,1); end.setFullYear(start.getFullYear()+1,0,1); }
  else { start.setDate(start.getDate()-30); end.setDate(end.getDate()+61); }
  return { from: `${dateInput(start)}T00:00`, to: `${dateInput(end)}T23:59` };
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(body.error ?? "The calendar request failed.");
  return body;
}

export function ChurchCalendarModule({ departmentId, csrfToken, department, canManageSite, language, realtime }: ModuleContext) {
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [archivedAppointments, setArchivedAppointments] = useState<ArchivedAppointment[]>([]);
  const [choices, setChoices] = useState<ChoiceSet>({ groups: [], signupGroups: [], events: [], resourceBookings: [], servicePlanTemplates: [], canSelectPeople: false });
  const [personSearch, setPersonSearch] = useState("");
  const [personChoices, setPersonChoices] = useState<PersonChoice[]>([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);
  const [anchor, setAnchor] = useState(new Date());
  const [view, setView] = useState<View>("month");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showCalendarForm, setShowCalendarForm] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [scope, setScope] = useState<"occurrence" | "future" | "series">("occurrence");
  const [draft, setDraft] = useState<Draft>(initialDraft());
  const [calendarName, setCalendarName] = useState("");
  const [calendarScope, setCalendarScope] = useState<Scope>("personal");
  const [groupId, setGroupId] = useState("");
  const [calendarColor, setCalendarColor] = useState("#3b82f6");
  const [extraStart, setExtraStart] = useState("");
  const [extraEnd, setExtraEnd] = useState("");
  const [extraDates, setExtraDates] = useState<ExtraDate[]>([]);
  const [registrationThrough, setRegistrationThrough] = useState("");
  const [eventRegistrationEnabled, setEventRegistrationEnabled] = useState(false);
  const [eventRegistrationCapacity, setEventRegistrationCapacity] = useState("");
  const [eventGenerationThrough, setEventGenerationThrough] = useState("");
  const [eventTemplateId, setEventTemplateId] = useState("");
  const [eventKind, setEventKind] = useState<"service" | "meeting" | "community" | "other">("service");
  const [eventStaffSearch, setEventStaffSearch] = useState("");
  const [eventStaffChoices, setEventStaffChoices] = useState<PersonChoice[]>([]);
  const [eventStaffAssignments, setEventStaffAssignments] = useState<Record<number, string>>({});
  const [eventStaffLabels, setEventStaffLabels] = useState<Record<string, string>>({});
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [publicFeedUrl, setPublicFeedUrl] = useState("");
  const canManageShared = canManageSite || (department.modulePermissions?.["church-calendar"] ?? []).includes("manage") || (department.permissions ?? []).some((permission) => ["events_manage", "groups_manage"].includes(permission));
  const canManageGroups = canManageSite || department.role === "site_admin" || (department.permissions ?? []).includes("groups_manage");
  const canManageEvents = canManageSite || department.role === "site_admin" || (department.permissions ?? []).includes("events_manage");
  const headers = useMemo(() => ({ "x-department-id": departmentId }), [departmentId]);
  const mutationHeaders = useMemo(() => ({ ...headers, "x-csrf-token": csrfToken, "content-type": "application/json" }), [headers, csrfToken]);
  const range = useMemo(() => getRange(anchor, view), [anchor, view]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [calendarRows, eventRows, choiceRows] = await Promise.all([
        api<Calendar[]>("/api/modules/church-calendar/calendars", { headers }),
        api<Appointment[]>(`/api/modules/church-calendar/appointments?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`, { headers }),
        api<ChoiceSet>("/api/modules/church-calendar/choices", { headers }),
      ]);
      setCalendars(calendarRows);
      setAppointments(eventRows);
      setChoices(choiceRows);
      setSelectedCalendarIds((current) => current.length ? current.filter((id) => calendarRows.some((item) => item.id === id)) : calendarRows.map((item) => item.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load the calendar."); }
    finally { setLoading(false); }
  }, [headers, range.from, range.to]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => realtime?.subscribe("module:church-calendar:changed", () => { void load(); }), [realtime, load]);
  useEffect(() => {
    if (!choices.canSelectPeople || personSearch.trim().length < 2) { setPersonChoices([]); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      void api<PersonChoice[]>(`/api/modules/church-calendar/people?q=${encodeURIComponent(personSearch.trim())}`, { headers })
        .then((rows) => { if (active) setPersonChoices(rows); })
        .catch(() => { if (active) setPersonChoices([]); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [choices.canSelectPeople, headers, personSearch]);

  useEffect(() => {
    if (!choices.canSelectPeople || eventStaffSearch.trim().length < 2) { setEventStaffChoices([]); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      void api<PersonChoice[]>(`/api/modules/church-calendar/people?q=${encodeURIComponent(eventStaffSearch.trim())}`, { headers })
        .then((rows) => { if (active) setEventStaffChoices(rows); })
        .catch(() => { if (active) setEventStaffChoices([]); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [choices.canSelectPeople, eventStaffSearch, headers]);

  const visibleAppointments = appointments.filter((item) => selectedCalendarIds.includes(item.calendarId));
  const selectedServiceTemplate = choices.servicePlanTemplates.find((template) => template.id === eventTemplateId);
  const eventStaffOptions = [...eventStaffChoices];
  for (const contactId of Object.values(eventStaffAssignments)) {
    if (contactId && !eventStaffOptions.some((person) => person.id === contactId)) eventStaffOptions.push({ id: contactId, name: eventStaffLabels[contactId] ?? "Selected person" });
  }
  function selectEventTemplate(templateId: string) {
    setEventTemplateId(templateId);
    setEventStaffAssignments({});
    setEventStaffLabels({});
  }
  function assignEventStaff(positionIndex: number, contactId: string) {
    setEventStaffAssignments((current) => {
      const next = { ...current };
      if (contactId) next[positionIndex] = contactId;
      else delete next[positionIndex];
      return next;
    });
    const contact = eventStaffChoices.find((person) => person.id === contactId);
    if (contact) setEventStaffLabels((current) => ({ ...current, [contact.id]: contact.name }));
  }
  function move(amount: number) {
    setAnchor((current) => { const next = new Date(current); if (view === "day") next.setDate(next.getDate()+amount); else if (view === "week" || view === "list") next.setDate(next.getDate()+7*amount); else if (view === "month") next.setMonth(next.getMonth()+amount); else next.setFullYear(next.getFullYear()+amount); return next; });
  }
  function openNew(date?: Date) {
    const start = date ? new Date(date) : new Date(anchor);
    if (view === "month" || view === "year" || view === "list") start.setHours(18,0,0,0);
    const end = new Date(start); end.setMinutes(end.getMinutes()+60);
    setEditing(null); setExtraDates([]); setImageFile(null); setScope("series");
    setPersonSearch(""); setPersonChoices([]);
    setDraft({ ...initialDraft(), ...monthlyWeekdayParts(start), calendarId: calendars.find((item) => item.scope === "personal" && item.isOwner)?.id ?? calendars.find((item) => item.scope === "community")?.id ?? calendars[0]?.id ?? "", startsAt: dateTimeInput(start), endsAt: dateTimeInput(end) });
    setShowForm(true);
  }
  async function openEdit(item: Appointment) {
    setEventRegistrationEnabled(false);
    setEventRegistrationCapacity("");
    setImageFile(null);
    setPersonSearch(item.responsiblePersonName ?? ""); setPersonChoices(item.responsibleContactId && item.responsiblePersonName ? [{ id: item.responsibleContactId, name: item.responsiblePersonName }] : []);
    setEditing(item); setScope(item.recurrence ? "occurrence" : "series"); setExtraStart(""); setExtraEnd("");
    setExtraDates([]);
    const seriesStart = new Date(`${item.seriesStartsAt.slice(0,10)}T00:00:00`);
    const maximumRegistrationDate = new Date(seriesStart); maximumRegistrationDate.setFullYear(maximumRegistrationDate.getFullYear() + 5);
    const registrationDefault = item.recurrence?.endsOn ? (item.recurrence.endsOn < dateInput(maximumRegistrationDate) ? item.recurrence.endsOn : dateInput(maximumRegistrationDate)) : (() => { const date = new Date(seriesStart); date.setFullYear(date.getFullYear() + 1); return dateInput(date); })();
    setRegistrationThrough(registrationDefault);
    setDraft({ calendarId: item.calendarId, title: item.title, subtitle: item.subtitle, description: item.description, startsAt: item.occurrenceStartAt.slice(0,16), endsAt: item.occurrenceEndAt.slice(0,16), allDay: item.allDay, place: item.place, url: item.url, internalOnly: item.internalOnly, tags: item.tags.join(", "), repeat: Boolean(item.recurrence), frequency: item.recurrence?.frequency ?? "weekly", interval: item.recurrence?.interval ?? 1, weekdays: item.recurrence?.weekdays ?? [], weekday: item.recurrence?.weekday ?? new Date(`${item.occurrenceStartAt.slice(0,10)}T00:00:00`).getDay(), weekOfMonth: item.recurrence?.weekOfMonth ?? monthlyWeekdayParts(new Date(`${item.occurrenceStartAt.slice(0,10)}T00:00:00`)).weekOfMonth, endsOn: item.recurrence?.endsOn ?? "", count: item.recurrence?.count ? String(item.recurrence.count) : "", manualDates: item.recurrence?.dates?.join(", ") ?? "", linkedEventId: item.linkedEventId ?? "", resourceBookingIds: item.resourceBookingIds ?? [], signupGroupId: item.signupGroupId ?? "", responsibleContactId: item.responsibleContactId ?? "" });
    if (item.canManage) {
      try { setExtraDates(await api<ExtraDate[]>(`/api/modules/church-calendar/appointments/${item.appointmentId}/extra-dates`, { headers })); }
      catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load extra dates."); }
    }
    setShowForm(true);
  }

  async function saveAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(""); setNotice("");
    const manualDates = draft.manualDates.split(",").map((date) => date.trim()).filter(Boolean);
    const recurrence: Recurrence | null = draft.repeat ? { frequency: draft.frequency, interval: draft.interval, weekdays: draft.frequency === "weekly" ? draft.weekdays : [], ...(draft.frequency === "monthly_weekday" ? { weekday: draft.weekday, weekOfMonth: draft.weekOfMonth } : {}), ...(draft.endsOn ? { endsOn: draft.endsOn } : {}), ...(draft.count ? { count: Number(draft.count) } : {}), ...(draft.frequency === "manual" ? { dates: manualDates } : {}) } : null;
    const payload = { calendarId: draft.calendarId, title: draft.title.trim(), subtitle: draft.subtitle, description: draft.description, startsAt: localToIso(draft.startsAt), endsAt: localToIso(draft.endsAt), allDay: draft.allDay, place: draft.place, url: draft.url, internalOnly: draft.internalOnly, tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean), recurrence, linkedEventId: draft.linkedEventId || null, resourceBookingIds: draft.resourceBookingIds, signupGroupId: draft.signupGroupId || null, ...(choices.canSelectPeople ? { responsibleContactId: draft.responsibleContactId || null } : {}), ...(editing ? { occurrenceStartAt: editing.occurrenceStartAt } : {}) };
    try {
      let appointmentId = editing?.appointmentId;
      if (editing) await api(`/api/modules/church-calendar/appointments/${editing.appointmentId}?scope=${scope}`, { method: "PUT", headers: mutationHeaders, body: JSON.stringify(payload) });
      else appointmentId = (await api<{ id: string }>("/api/modules/church-calendar/appointments", { method: "POST", headers: mutationHeaders, body: JSON.stringify(payload) })).id;
      if (imageFile && appointmentId) {
        const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.onerror = () => reject(new Error("Could not read the appointment image.")); reader.readAsDataURL(imageFile); });
        await api(`/api/modules/church-calendar/appointments/${appointmentId}/image`, { method: "PUT", headers: mutationHeaders, body: JSON.stringify({ filename: imageFile.name, contentType: imageFile.type, data }) });
      }
      setNotice(editing ? "Appointment updated." : "Appointment created."); setShowForm(false); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save this appointment."); }
    finally { setBusy(false); }
  }

  async function generateRegistrationGroups() {
    if (!editing?.recurrence || !registrationThrough || busy) return;
    if (!window.confirm(`Create one unpublished group for each generated appointment occurrence through ${registrationThrough}? Public signup will stay disabled until a group manager enables it.`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ created: number; alreadyLinked: number; skippedCancelled: number }>(`/api/modules/church-calendar/appointments/${editing.appointmentId}/registration-groups`, { method: "POST", headers: mutationHeaders, body: JSON.stringify({ throughDate: registrationThrough }) });
      setNotice(`${result.created} registration groups created; ${result.alreadyLinked} occurrences already linked; ${result.skippedCancelled} cancelled occurrences skipped.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not generate registration groups."); }
    finally { setBusy(false); }
  }

  async function generateServiceEvents() {
    if (!editing?.recurrence || !eventGenerationThrough || !eventTemplateId || busy) return;
    const registrationCapacity = eventRegistrationCapacity ? Number(eventRegistrationCapacity) : undefined;
    if (eventRegistrationEnabled && registrationCapacity !== undefined && (!Number.isInteger(registrationCapacity) || registrationCapacity < 1 || registrationCapacity > 100000)) {
      setError("Enter a registration capacity of 1 to 100,000, or leave it blank.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    const staffAssignments = Object.entries(eventStaffAssignments).flatMap(([positionIndex, contactId]) => {
      const index = Number(positionIndex);
      const positionName = selectedServiceTemplate?.positions[index]?.name;
      return contactId && positionName ? [{ positionIndex: index, positionName, contactId }] : [];
    });
    const body = { throughDate: eventGenerationThrough, templateId: eventTemplateId, kind: eventKind, ...(eventRegistrationEnabled ? { registrationEnabled: true, registrationCapacity } : {}), ...(choices.canSelectPeople && staffAssignments.length ? { staffAssignments } : {}) };
    try {
      const preview = await api<{ planned: number; alreadyLinked: number; skippedCancelled: number }>(`/api/modules/church-calendar/appointments/${editing.appointmentId}/service-events`, { method: "POST", headers: mutationHeaders, body: JSON.stringify({ ...body, preview: true }) });
      if (preview.planned === 0) {
        setNotice(`Preview: no new events. ${preview.alreadyLinked} occurrences are already linked; ${preview.skippedCancelled} are cancelled.`);
        return;
      }
      const templateName = choices.servicePlanTemplates.find((template) => template.id === eventTemplateId)?.name ?? "the selected template";
      const assignmentSummary = staffAssignments.length ? ` ${staffAssignments.length} role assignments will be copied to each event.` : " Events will have no assigned volunteers.";
      const registrationSummary = eventRegistrationEnabled ? (registrationCapacity ? ` Each event will have public registration with ${registrationCapacity} places and a waitlist.` : " Each event will have public registration without a capacity limit.") : "";
      if (!window.confirm(`Preview: create ${preview.planned} ${eventKind} events using “${templateName}” through ${eventGenerationThrough}?${assignmentSummary}${registrationSummary} ${preview.alreadyLinked} already-linked and ${preview.skippedCancelled} cancelled occurrences will be skipped.`)) return;
      const result = await api<{ created: number; alreadyLinked: number; skippedCancelled: number }>(`/api/modules/church-calendar/appointments/${editing.appointmentId}/service-events`, { method: "POST", headers: mutationHeaders, body: JSON.stringify(body) });
      setNotice(`${result.created} service events created; ${result.alreadyLinked} already-linked occurrences and ${result.skippedCancelled} cancelled occurrences skipped.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not generate service events."); }
    finally { setBusy(false); }
  }

  async function removeAppointmentImage() {
    if (!editing || busy || !editing.imageUrl) return;
    setBusy(true); setError("");
    try { await api(`/api/modules/church-calendar/appointments/${editing.appointmentId}/image`, { method: "DELETE", headers: mutationHeaders, body: "{}" }); setEditing({ ...editing, imageUrl: null }); setNotice("Appointment image removed."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not remove this image."); }
    finally { setBusy(false); }
  }

  async function removeAppointment() {
    if (!editing || busy || !window.confirm("Remove this appointment? A full-series removal moves it to the calendar archive.")) return;
    setBusy(true); setError("");
    try {
      await api(`/api/modules/church-calendar/appointments/${editing.appointmentId}?scope=${scope}&occurrenceStartAt=${encodeURIComponent(editing.occurrenceStartAt)}`, { method: "DELETE", headers: mutationHeaders });
      setShowForm(false); setNotice("Appointment removed."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not remove this appointment."); }
    finally { setBusy(false); }
  }

  async function addExtraDate() {
    if (!editing || !extraStart || !extraEnd || busy) return;
    setBusy(true); setError("");
    try {
      await api(`/api/modules/church-calendar/appointments/${editing.appointmentId}/extra-dates`, { method: "POST", headers: mutationHeaders, body: JSON.stringify({ startsAt: localToIso(extraStart), endsAt: localToIso(extraEnd) }) });
      setNotice("Extra date added."); setExtraStart(""); setExtraEnd(""); setExtraDates(await api<ExtraDate[]>(`/api/modules/church-calendar/appointments/${editing.appointmentId}/extra-dates`, { headers })); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add this date."); }
    finally { setBusy(false); }
  }

  async function removeExtraDate(date: ExtraDate) {
    if (!editing || busy || !window.confirm(`Remove the extra appointment on ${date.startsAt.replace("T", " ").slice(0,16)}?`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/modules/church-calendar/appointments/${editing.appointmentId}/extra-dates?startsAt=${encodeURIComponent(date.startsAt)}`, { method: "DELETE", headers: mutationHeaders });
      setExtraDates((current) => current.filter((item) => item.startsAt !== date.startsAt)); setNotice("Extra date removed."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not remove this extra date."); }
    finally { setBusy(false); }
  }

  async function createCalendar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      const created = await api<Calendar>("/api/modules/church-calendar/calendars", { method: "POST", headers: mutationHeaders, body: JSON.stringify({ name: calendarName, scope: calendarScope, ...(calendarScope === "group" ? { groupId } : {}), color: calendarColor }) });
      setCalendarName(""); setGroupId(""); setShowCalendarForm(false); await load(); setSelectedCalendarIds((current) => [...new Set([...current, created.id])]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create this calendar."); }
    finally { setBusy(false); }
  }

  async function issuePublicFeed(calendar: Calendar) {
    if (busy) return;
    setBusy(true); setError(""); setPublicFeedUrl("");
    try { const result = await api<{ url: string }>(`/api/modules/church-calendar/calendars/${calendar.id}/public-feed`, { method: "POST", headers: mutationHeaders, body: "{}" }); setPublicFeedUrl(new URL(result.url, window.location.origin).toString()); setNotice(calendar.hasPublicFeed ? "Public feed link rotated. The previous link no longer works." : "Public feed link created."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create the public feed link."); }
    finally { setBusy(false); }
  }

  async function revokePublicFeed(calendar: Calendar) {
    if (busy || !window.confirm(`Revoke the public feed for ${calendar.name}? Existing subscribers will stop receiving updates.`)) return;
    setBusy(true); setError(""); setPublicFeedUrl("");
    try { await api(`/api/modules/church-calendar/calendars/${calendar.id}/public-feed`, { method: "DELETE", headers: mutationHeaders, body: "{}" }); setNotice("Public calendar feed revoked."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not revoke the public feed."); }
    finally { setBusy(false); }
  }

  async function toggleArchive() {
    if (!showArchive) {
      setError("");
      try { setArchivedAppointments(await api<ArchivedAppointment[]>("/api/modules/church-calendar/archive", { headers })); }
      catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load the calendar archive."); return; }
    }
    setShowArchive(!showArchive);
  }

  async function restoreAppointment(id: string) {
    setBusy(true); setError("");
    try {
      await api(`/api/modules/church-calendar/appointments/${id}/restore`, { method: "POST", headers: mutationHeaders, body: "{}" });
      setArchivedAppointments((current) => current.filter((item) => item.appointmentId !== id));
      setNotice("Appointment restored."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not restore this appointment."); }
    finally { setBusy(false); }
  }

  const eventsForDay = (day: Date) => visibleAppointments.filter((event) => event.occurrenceStartAt.slice(0,10) === dateInput(day));
  const monthGridStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1); monthGridStart.setDate(monthGridStart.getDate()-((monthGridStart.getDay()+6)%7));
  const locale = language;
  function appointmentButton(item: Appointment) {
    return (
      <div key={`${item.appointmentId}:${item.occurrenceStartAt}`} className="church-calendar-appointment-entry">
        <button type="button" className="church-calendar-event" style={{ "--calendar-accent": calendars.find((calendar) => calendar.id === item.calendarId)?.color ?? "#3b82f6" } as CSSProperties} onClick={() => openEdit(item)}>
          <strong>{item.allDay ? "All day" : new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(item.occurrenceStartAt))} {item.title}</strong>
          {item.place && <span><MapPin size={12} /> {item.place}</span>}
          {item.responsiblePersonName && <span className="church-calendar-responsible">On behalf of {item.responsiblePersonName}</span>}
        </button>
        {item.signupToken ? <a className="church-calendar-signup-link" href={`/join-group/${item.signupToken}`} target="_blank" rel="noreferrer">Sign up: {item.signupGroupName ?? "Group"}</a> : item.signupGroupName ? <span className="church-calendar-signup-link">Registration group: {item.signupGroupName}</span> : null}
      </div>
    );
  }

  return <main className="church-calendar-page">
    <header className="church-calendar-header"><div><span className="eyebrow">PLANNING</span><h1>Calendar</h1><p>Appointments across your community, groups and personal calendars.</p></div><div className="church-calendar-header-actions"><button type="button" className="button button-secondary" onClick={() => void toggleArchive()}>{showArchive ? "Hide archive" : "Archive"}</button><button type="button" className="button button-secondary" onClick={() => setShowCalendarForm(true)}><Plus size={15} /> New calendar</button><button type="button" className="button button-primary" onClick={() => openNew()}><Plus size={15} /> New appointment</button></div></header>
    {error && <div className="church-calendar-message church-calendar-error" role="alert">{error}</div>}{notice && <div className="church-calendar-message church-calendar-success" role="status">{notice}</div>}
    {showArchive && <section className="church-calendar-archive" aria-label="Archived appointments"><header><div><h2>Archived appointments</h2><p>Restore an appointment to return it to its calendar.</p></div><span>{archivedAppointments.length}</span></header>{archivedAppointments.length ? archivedAppointments.map((item) => <article key={item.appointmentId}><div><strong>{item.title}</strong><small>{item.calendarName} · {dayLabel(new Date(item.startsAt), language)}</small></div><button type="button" className="button button-secondary" onClick={() => void restoreAppointment(item.appointmentId)} disabled={busy}>Restore</button></article>) : <p className="church-calendar-empty">No archived appointments.</p>}</section>}
    <div className="church-calendar-layout"><aside className="church-calendar-sidebar"><div className="church-calendar-mini-head"><strong>{monthLabel(anchor, language)}</strong><button className="icon-button" aria-label="Previous month" type="button" onClick={() => setAnchor((d) => new Date(d.getFullYear(), d.getMonth()-1, d.getDate()))}><ChevronLeft size={15} /></button><button className="icon-button" aria-label="Next month" type="button" onClick={() => setAnchor((d) => new Date(d.getFullYear(), d.getMonth()+1, d.getDate()))}><ChevronRight size={15} /></button></div><div className="church-calendar-mini-grid">{weekDays.map((day) => <span key={day}>{day[0]}</span>)}{Array.from({ length: 42 }, (_, index) => { const day = new Date(monthGridStart); day.setDate(day.getDate()+index); return <button key={index} className={`${day.getMonth() === anchor.getMonth() ? "" : "outside"} ${dateInput(day) === dateInput(anchor) ? "selected" : ""}`} type="button" onClick={() => setAnchor(day)}>{day.getDate()}</button>; })}</div><button type="button" className="church-calendar-today" onClick={() => setAnchor(new Date())}>Today</button><h2>My calendars</h2><div className="church-calendar-list">{calendars.map((calendar) => <label key={calendar.id}><input type="checkbox" checked={selectedCalendarIds.includes(calendar.id)} onChange={(event) => setSelectedCalendarIds((current) => event.target.checked ? [...current, calendar.id] : current.filter((id) => id !== calendar.id))} /><i style={{ background: calendar.color }} /><span>{calendar.name}</span><small>{calendar.scope === "personal" ? "Personal" : calendar.scope === "group" ? calendar.groupName ?? "Group" : "Community"}</small></label>)}</div>{canManageShared && calendars.filter((calendar) => calendar.scope === "community").length > 0 && <section className="church-calendar-public-feed-settings"><h2>Public calendar feeds</h2>{calendars.filter((calendar) => calendar.scope === "community").map((calendar) => <div key={calendar.id}><span>{calendar.name}</span>{calendar.hasPublicFeed ? <><small>Feed enabled</small><button type="button" className="church-calendar-feed-button" onClick={() => void issuePublicFeed(calendar)} disabled={busy}>Rotate link</button><button type="button" className="church-calendar-feed-button" onClick={() => void revokePublicFeed(calendar)} disabled={busy}>Revoke</button></> : <button type="button" className="church-calendar-feed-button" onClick={() => void issuePublicFeed(calendar)} disabled={busy}>Create feed link</button>}</div>)}</section>}{publicFeedUrl && <div className="church-calendar-feed-result"><strong>Copy this calendar URL. It is shown only once.</strong><a href={publicFeedUrl}>{publicFeedUrl}</a></div>}{!calendars.length && !loading && <p className="church-calendar-empty">Create your first personal calendar or a shared calendar.</p>}</aside>
      <section className="church-calendar-main"><div className="church-calendar-toolbar"><div className="church-calendar-date-nav"><button type="button" className="icon-button" aria-label="Previous" onClick={() => move(-1)}><ChevronLeft size={18} /></button><button type="button" className="icon-button" aria-label="Next" onClick={() => move(1)}><ChevronRight size={18} /></button><h2>{view === "year" ? anchor.getFullYear() : monthLabel(anchor, language)}</h2><button type="button" className="church-calendar-today" onClick={() => setAnchor(new Date())}>Today</button></div><div className="church-calendar-views" role="group" aria-label="Calendar view">{(["day", "week", "month", "year", "list"] as View[]).map((item) => <button type="button" key={item} className={view === item ? "active" : ""} aria-pressed={view === item} onClick={() => setView(item)}>{item[0].toUpperCase()+item.slice(1)}</button>)}</div></div>
        {loading ? <div className="church-calendar-loading"><RotateCcw size={18} className="spinning" /> Loading appointments…</div> : view === "month" ? <div className="church-calendar-month"><div className="church-calendar-weekdays">{["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day) => <span key={day}>{day}</span>)}</div><div className="church-calendar-month-grid">{Array.from({ length: 42 }, (_, index) => { const day = new Date(monthGridStart); day.setDate(day.getDate()+index); return <div key={index} className={`church-calendar-day ${day.getMonth() !== anchor.getMonth() ? "outside" : ""}`}><button className="church-calendar-day-number" type="button" onClick={() => { setAnchor(day); setView("day"); }}>{day.getDate()}</button>{eventsForDay(day).slice(0,4).map(appointmentButton)}{eventsForDay(day).length > 4 && <small>+{eventsForDay(day).length-4} more</small>}</div>; })}</div></div> : view === "week" || view === "day" ? <div className={`church-calendar-columns church-calendar-columns-${view}`}>{Array.from({ length: view === "day" ? 1 : 7 }, (_, index) => { const day = new Date(anchor); if (view === "week") day.setDate(day.getDate()-((day.getDay()+6)%7)+index); return <section key={index} className="church-calendar-column"><header><strong>{dayLabel(day, language)}</strong><button type="button" aria-label={`New appointment ${dateInput(day)}`} onClick={() => openNew(day)}><Plus size={14} /></button></header>{eventsForDay(day).map(appointmentButton)}{!eventsForDay(day).length && <button type="button" className="church-calendar-add-slot" onClick={() => openNew(day)}>Add appointment</button>}</section>; })}</div> : view === "year" ? <div className="church-calendar-year">{Array.from({ length: 12 }, (_, month) => { const first = new Date(anchor.getFullYear(), month, 1); const count = visibleAppointments.filter((event) => new Date(event.occurrenceStartAt).getMonth() === month).length; return <button type="button" key={month} onClick={() => { setAnchor(first); setView("month"); }}><strong>{new Intl.DateTimeFormat(locale, { month: "long" }).format(first)}</strong><span>{count} appointments</span></button>; })}</div> : <div className="church-calendar-list-view">{visibleAppointments.map((item) => <button type="button" key={`${item.appointmentId}:${item.occurrenceStartAt}`} onClick={() => openEdit(item)}><span className="church-calendar-list-date">{dayLabel(new Date(item.occurrenceStartAt), language)}</span><span className="church-calendar-list-title"><strong>{item.title}</strong><small>{item.calendarName}{item.place ? ` · ${item.place}` : ""}{item.responsiblePersonName ? ` · On behalf of ${item.responsiblePersonName}` : ""}</small></span><span>{item.allDay ? "All day" : new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(item.occurrenceStartAt))}</span><ChevronRight size={16} /></button>)}</div>}
        {!loading && !visibleAppointments.length && <div className="church-calendar-empty-state"><CalendarDays size={28} /><strong>No appointments in this view</strong><span>Try another date or add an appointment.</span><button type="button" className="button button-primary" onClick={() => openNew()}><Plus size={15} /> New appointment</button></div>}
      </section></div>
    {showCalendarForm && <div className="church-calendar-modal-backdrop" role="presentation"><section className="church-calendar-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-create-heading"><header><div><span className="eyebrow">CALENDAR SETUP</span><h2 id="calendar-create-heading">New calendar</h2></div><button className="icon-button" type="button" aria-label="Close" onClick={() => setShowCalendarForm(false)}><X size={18} /></button></header><form onSubmit={(event) => void createCalendar(event)}><label>Calendar name<input required maxLength={120} value={calendarName} onChange={(event) => setCalendarName(event.target.value)} /></label><label>Calendar type<select value={calendarScope} onChange={(event) => setCalendarScope(event.target.value as Scope)}><option value="personal">Personal</option>{canManageShared && <><option value="community">Community</option><option value="group">Group</option></>}</select></label>{calendarScope === "group" && <label>Group<select required value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">Choose group</option>{choices.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}<label>Color<input type="color" value={calendarColor} onChange={(event) => setCalendarColor(event.target.value)} /></label><footer><button type="button" className="button button-secondary" onClick={() => setShowCalendarForm(false)}>Cancel</button><button type="submit" className="button button-primary" disabled={busy || !calendarName.trim()}><Plus size={15} /> Create calendar</button></footer></form></section></div>}
    {showForm && <div className="church-calendar-modal-backdrop" role="presentation"><section className="church-calendar-modal church-calendar-appointment-modal" role="dialog" aria-modal="true" aria-labelledby="appointment-heading"><header><div><span className="eyebrow">{editing ? "APPOINTMENT DETAILS" : "NEW APPOINTMENT"}</span><h2 id="appointment-heading">{editing ? "Edit appointment" : "Create appointment"}</h2></div><button className="icon-button" type="button" aria-label="Close" onClick={() => setShowForm(false)}><X size={18} /></button></header><form onSubmit={(event) => void saveAppointment(event)}><div className="church-calendar-form-grid"><label className="wide">Title<input required maxLength={160} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><label>Calendar<select required value={draft.calendarId} onChange={(event) => setDraft({ ...draft, calendarId: event.target.value })}>{calendars.filter((calendar) => calendar.scope === "personal" ? calendar.isOwner : canManageShared).map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</select></label><label>Subtitle<input maxLength={240} value={draft.subtitle} onChange={(event) => setDraft({ ...draft, subtitle: event.target.value })} /></label>{choices.canSelectPeople && <div className="church-calendar-person-picker"><label>On behalf of · search People<input type="search" minLength={2} maxLength={80} value={personSearch} onChange={(event) => { setPersonSearch(event.target.value); setDraft({ ...draft, responsibleContactId: "" }); }} placeholder="Enter a name" /></label><label>Person<select value={draft.responsibleContactId} onChange={(event) => setDraft({ ...draft, responsibleContactId: event.target.value })}><option value="">No person selected</option>{personChoices.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><small>Only People records in this location are available. Contact details are not shared with other calendar viewers.</small></div>}<label>Starts<input type="datetime-local" required value={draft.startsAt} onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })} /></label><label>Ends<input type="datetime-local" required value={draft.endsAt} onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })} /></label><label>Place<input maxLength={200} value={draft.place} onChange={(event) => setDraft({ ...draft, place: event.target.value })} /></label><label>Web link<input type="url" maxLength={1000} value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="https://" /></label><label>Appointment image<input type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={(event) => { const file = event.target.files?.[0] ?? null; if (file && file.size > 1048576) { setError("Choose an image smaller than 1 MiB."); setImageFile(null); } else { setError(""); setImageFile(file); } }} /><small>JPEG, PNG, GIF or WebP, up to 1 MiB.</small></label>{imageFile && <small className="wide">Selected: {imageFile.name}</small>}{editing?.imageUrl && <div className="church-calendar-image-preview wide"><img src={editing.imageUrl} alt="Current appointment" /><button type="button" className="button button-secondary" onClick={() => void removeAppointmentImage()} disabled={busy}>Remove image</button></div>}<label className="wide">Description<textarea rows={4} maxLength={8000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label><label>Tags<input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="Separate with commas" /></label><label>Link service/event<select value={draft.linkedEventId} onChange={(event) => setDraft({ ...draft, linkedEventId: event.target.value })}><option value="">No linked event</option>{choices.events.map((choice) => <option key={choice.id} value={choice.id}>{choice.event_date} · {choice.title}</option>)}</select></label><label>Group signup<select value={draft.signupGroupId} onChange={(event) => setDraft({ ...draft, signupGroupId: event.target.value })}><option value="">No signup link</option>{choices.signupGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><small>Existing public group signup page.</small></label><label>Link approved resource bookings<select multiple value={draft.resourceBookingIds} onChange={(event) => setDraft({ ...draft, resourceBookingIds: Array.from(event.currentTarget.selectedOptions, (option) => option.value) })}>{choices.resourceBookings.map((booking) => <option key={booking.id} value={booking.id}>{booking.starts_at.slice(0,16).replace("T", " ")} · {booking.purpose}</option>)}</select><small>Hold Ctrl or Command to select multiple bookings.</small></label><label className="church-calendar-check"><input type="checkbox" checked={draft.allDay} onChange={(event) => setDraft({ ...draft, allDay: event.target.checked })} /> All day</label><label className="church-calendar-check"><input type="checkbox" checked={draft.internalOnly} onChange={(event) => setDraft({ ...draft, internalOnly: event.target.checked })} /> Internal appointment</label><label className="church-calendar-check wide"><input type="checkbox" checked={draft.repeat} onChange={(event) => setDraft({ ...draft, repeat: event.target.checked })} /><Repeat2 size={15} /> Repeat appointment</label>{draft.repeat && <div className="church-calendar-recurrence wide"><label>Repeat pattern<select value={draft.frequency} onChange={(event) => setDraft({ ...draft, frequency: event.target.value as Frequency })}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly by date</option><option value="monthly_weekday">Monthly by weekday</option><option value="yearly">Yearly</option><option value="manual">Manual dates</option></select></label><label>Every<input type="number" min={1} max={365} value={draft.interval} onChange={(event) => setDraft({ ...draft, interval: Number(event.target.value) })} /></label>{draft.frequency === "weekly" && <fieldset><legend>Days of week</legend>{weekDays.map((day, index) => <label key={day}><input type="checkbox" checked={draft.weekdays.includes(index)} onChange={(event) => setDraft({ ...draft, weekdays: event.target.checked ? [...draft.weekdays, index] : draft.weekdays.filter((value) => value !== index) })} />{day}</label>)}</fieldset>}{draft.frequency === "monthly_weekday" && <><label>Week of month<select value={draft.weekOfMonth} onChange={(event) => setDraft({ ...draft, weekOfMonth: Number(event.target.value) })}><option value={1}>First</option><option value={2}>Second</option><option value={3}>Third</option><option value={4}>Fourth</option><option value={-1}>Last</option></select></label><label>Weekday<select value={draft.weekday} onChange={(event) => setDraft({ ...draft, weekday: Number(event.target.value) })}>{weekDays.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label></>}{draft.frequency === "manual" && <div className="church-calendar-manual-dates"><label className="wide">Manual dates<input type="text" placeholder="YYYY-MM-DD, YYYY-MM-DD" value={draft.manualDates} onChange={(event) => setDraft({ ...draft, manualDates: event.target.value })} /><small>Enter up to 100 dates separated by commas.</small></label></div>}<label>End date<input type="date" value={draft.endsOn} onChange={(event) => setDraft({ ...draft, endsOn: event.target.value })} /></label><label>Or after occurrences<input type="number" min={1} max={500} value={draft.count} onChange={(event) => setDraft({ ...draft, count: event.target.value })} /></label></div>}{editing?.recurrence && <label className="wide">Apply changes<select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="occurrence">This appointment only</option><option value="future">This and following</option><option value="series">Entire series</option></select></label>}{editing?.recurrence && canManageGroups && <div className="church-calendar-extra-date wide"><strong>Generate registration groups</strong><div><label>Generate through<input type="date" min={editing.seriesStartsAt.slice(0,10)} max={(() => { const date = new Date(`${editing.seriesStartsAt.slice(0,10)}T00:00:00`); date.setFullYear(date.getFullYear() + 5); return dateInput(date); })()} value={registrationThrough} onChange={(event) => setRegistrationThrough(event.target.value)} /></label><button type="button" className="button button-secondary" onClick={() => void generateRegistrationGroups()} disabled={!registrationThrough || busy}><Plus size={14} /> Generate groups</button></div><small>Creates an unpublished group for each occurrence through this date. Signup starts disabled. Up to 500 occurrences are processed.</small></div>}{editing?.recurrence && canManageEvents && <div className="church-calendar-extra-date wide"><strong>Generate service events from a template</strong><div><label>Service-plan template<select value={eventTemplateId} onChange={(event) => selectEventTemplate(event.target.value)}><option value="">Choose a template…</option>{choices.servicePlanTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>{choices.canSelectPeople && (selectedServiceTemplate?.positions?.length ?? 0) > 0 && <div className="church-calendar-staff-picker"><label className="wide">Search People to assign<input type="search" minLength={2} maxLength={80} value={eventStaffSearch} onChange={(event) => setEventStaffSearch(event.target.value)} placeholder="Enter at least two letters" /></label><div className="church-calendar-staff-roles">{selectedServiceTemplate!.positions.map((position, index) => <label className="church-calendar-staff-role" key={`${index}-${position.name}`}><span>{position.name}</span><select value={eventStaffAssignments[index] ?? ""} onChange={(event) => assignEventStaff(index, event.target.value)}><option value="">Unassigned</option>{eventStaffOptions.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>)}</div><small className="wide">Selected volunteers are assigned to the matching template role in every generated event. Leave a role unassigned to keep it open.</small></div>}<label>Event kind<select value={eventKind} onChange={(event) => setEventKind(event.target.value as typeof eventKind)}><option value="service">Service</option><option value="meeting">Meeting</option><option value="community">Community</option><option value="other">Other</option></select></label><label className="church-calendar-check"><input type="checkbox" checked={eventRegistrationEnabled} onChange={(event) => setEventRegistrationEnabled(event.target.checked)} /> Enable public event registration</label>{eventRegistrationEnabled && <label>Capacity per event<input type="number" min={1} max={100000} step={1} value={eventRegistrationCapacity} onChange={(event) => setEventRegistrationCapacity(event.target.value)} placeholder="Unlimited" /><small>Public registration requires a community appointment. Find each generated registration link in Services &amp; events.</small></label>}<label>Generate through<input type="date" min={editing.seriesStartsAt.slice(0,10)} max={(() => { const date = new Date(`${editing.seriesStartsAt.slice(0,10)}T00:00:00`); date.setFullYear(date.getFullYear() + 5); return dateInput(date); })()} value={eventGenerationThrough} onChange={(event) => setEventGenerationThrough(event.target.value)} /></label><button type="button" className="button button-secondary" onClick={() => void generateServiceEvents()} disabled={!eventGenerationThrough || !eventTemplateId || busy}><Plus size={14} /> Preview and generate</button></div><small>Shows a preview before creating events. Existing links and cancelled occurrences are skipped. Up to 500 occurrences are processed.</small></div>}{editing?.recurrence && <div className="church-calendar-extra-date wide"><strong>Add an extra date to this series</strong><div><input aria-label="Extra date starts" type="datetime-local" value={extraStart} onChange={(event) => setExtraStart(event.target.value)} /><input aria-label="Extra date ends" type="datetime-local" value={extraEnd} onChange={(event) => setExtraEnd(event.target.value)} /><button type="button" className="button button-secondary" onClick={() => void addExtraDate()} disabled={!extraStart || !extraEnd || busy}><Plus size={14} /> Add date</button></div>{extraDates.length ? <ul className="church-calendar-extra-date-list">{extraDates.map((date) => <li key={date.startsAt}><span>{date.startsAt.replace("T", " ").slice(0,16)} – {date.endsAt.slice(11,16)}</span><button type="button" className="button button-secondary" onClick={() => void removeExtraDate(date)} disabled={busy}>Remove</button></li>)}</ul> : <small>No extra dates have been added.</small>}</div>}</div><footer>{editing?.canManage && <button type="button" className="button button-danger" onClick={() => void removeAppointment()} disabled={busy}><Trash2 size={15} /> Remove</button>}<span /><button type="button" className="button button-secondary" onClick={() => setShowForm(false)}>Cancel</button><button type="submit" className="button button-primary" disabled={busy || !draft.title.trim() || !draft.calendarId}><Plus size={15} /> {busy ? "Saving…" : editing ? "Save changes" : "Create appointment"}</button></footer></form></section></div>}
  </main>;
}
