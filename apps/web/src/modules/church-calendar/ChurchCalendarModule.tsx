import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, Plus, Printer, Repeat2, RotateCcw, Trash2, X } from "lucide-react";
import type { ModuleContext } from "../../module-registry";
import { CalendarResourceRequest } from "./CalendarResourceRequest";
import { CalendarGroupMeeting } from "./CalendarGroupMeeting";
import { GroupMeetingAttendance, type GroupMeetingTarget } from "../check-in/GroupMeetingAttendance";
import "./church-calendar.css";
import { calendarPrintDocument } from "./calendar-print";
import { AppointmentTemplates } from "./AppointmentTemplates";
import { applyAppointmentTemplate } from "./appointment-template-draft";

type Scope = "community" | "group" | "personal";
type View = "day" | "week" | "month" | "year" | "list";
type Calendar = { id: string; name: string; scope: Scope; groupId: string | null; groupName?: string; ownerUserId: string | null; color: string; isOwner?: boolean; hasPublicFeed?: boolean; canSubscribe?: boolean; hasSubscription?: boolean };
type Frequency = "daily" | "weekly" | "monthly" | "monthly_weekday" | "yearly" | "manual";
type Recurrence = { frequency: Frequency; interval: number; weekdays: number[]; weekday?: number; weekOfMonth?: number; endsOn?: string; count?: number; dates?: string[] };
type EventRegistration = { token: string; capacity: number | null; open: boolean; registered: number; waitlisted: number };
type LinkedResourceBooking = {
  id: string; name: string; status: string; scope: "series" | "occurrence";
  leadInMinutes: number; cleanupMinutes: number; timeMismatch?: boolean;
};
type Appointment = {
  appointmentId: string; occurrenceStartAt: string; occurrenceEndAt: string; originalOccurrenceStartAt?: string; seriesTimeZone?: string | null; timeZone?: string; startsAtUtc?: string | null; timeShifted?: boolean; seriesStartsAt: string; calendarId: string; calendarName: string; calendarScope: Scope;
  groupId?: string | null; title: string; subtitle: string; description: string; allDay: boolean; place: string; url: string;
  internalOnly: boolean; tags: string[]; recurrence: Recurrence | null; linkedEventId: string | null; resourceBookingIds: string[]; canManage: boolean;
  viewStartsAt?: string; viewTimeZone?: string;
  reminder?: { minutesBefore?: number; clockTime?: string; clockTimeZone?: string; delivered: boolean } | null;
  resourceBookings?: LinkedResourceBooking[];
  resourceWindow?: { startsAt: string; endsAt: string } | null;
  linkedEventCancelled?: boolean; eventRegistration?: EventRegistration | null;
  imageUrl?: string | null; signupGroupId?: string | null; signupGroupName?: string | null; signupToken?: string | null; responsibleContactId?: string | null; responsiblePersonName?: string | null;
};
type ArchivedAppointment = { appointmentId: string; title: string; startsAt: string; calendarId: string; calendarName: string; calendarScope: Scope; ownerUserId: string | null };
type ExtraDate = { startsAt: string; endsAt: string };
type ChoiceSet = { registrationFormTemplates?: Array<{ id: string; name: string }>; groups: Array<{ id: string; name: string }>; signupGroups: Array<{ id: string; name: string; token: string }>; events: Array<{ id: string; title: string; event_date: string }>; resourceBookings: Array<{ id: string; purpose: string; starts_at: string }>; servicePlanTemplates: Array<{ id: string; name: string; positions: Array<{ name: string; category?: string; qualificationIds?: string[] }> }>; canSelectPeople?: boolean };
type PersonChoice = { id: string; name: string; qualificationIds?: string[] };
type Draft = { timeZone: string; calendarId: string; title: string; subtitle: string; description: string; startsAt: string; endsAt: string; allDay: boolean; place: string; url: string; internalOnly: boolean; tags: string; repeat: boolean; frequency: Frequency; interval: number; weekdays: number[]; weekday: number; weekOfMonth: number; endsOn: string; count: string; manualDates: string; linkedEventId: string; resourceBookingIds: string[]; signupGroupId: string; responsibleContactId: string };
const initialDraft = (): Draft => ({ timeZone: "", calendarId: "", title: "", subtitle: "", description: "", startsAt: "", endsAt: "", allDay: false, place: "", url: "", internalOnly: false, tags: "", repeat: false, frequency: "weekly", interval: 1, weekdays: [], weekday: 0, weekOfMonth: 1, endsOn: "", count: "", manualDates: "", linkedEventId: "", resourceBookingIds: [], signupGroupId: "", responsibleContactId: "" });
const namedTimeZones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
const displayPreferencePrefix = "display-time-zone:";
function validNamedZone(zone: string | undefined) {
  if (!zone || !/^[A-Za-z][A-Za-z0-9_+/-]{0,79}$/.test(zone)) return null;
  try { return new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone ?? null; }
  catch { return null; }
}
function displayPreference(state: string) {
  const requested = state.startsWith(displayPreferencePrefix) ? state.slice(displayPreferencePrefix.length) : "";
  return requested === "location" || requested === "device" ? requested : validNamedZone(requested) ?? "appointments";
}
function todayInZone(timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", calendar: "iso8601", numberingSystem: "latn" });
  const parts = Object.fromEntries(formatter.formatToParts().map(({ type, value }) => [type,value]));
  return new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00`);
}
const displayStart = (appointment: Appointment) => appointment.viewStartsAt ?? appointment.occurrenceStartAt;
const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");
function dateInput(date: Date) { return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`; }
function dateTimeInput(date: Date) { return `${dateInput(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`; }
function monthlyWeekdayParts(date: Date) { const last = new Date(date); last.setDate(last.getDate() + 7); return { weekday: date.getDay(), weekOfMonth: last.getMonth() !== date.getMonth() ? -1 : Math.floor((date.getDate() - 1) / 7) + 1 }; }
function dateFromLocal(value: string) { return new Date(`${value.slice(0,10)}T00:00:00`); }
function dayLabel(date: Date, language: string) { return new Intl.DateTimeFormat(language === "de" ? "de-CH" : language === "fr" ? "fr-CH" : language === "it" ? "it-CH" : "en-GB", { weekday: "short", day: "numeric", month: "short" }).format(date); }
function shiftCalendarMonth(date: Date, months: number) {
  const shifted = new Date(date);
  const day = shifted.getDate();
  shifted.setDate(1);
  shifted.setMonth(shifted.getMonth() + months);
  const lastDay = new Date(shifted);
  lastDay.setMonth(lastDay.getMonth() + 1, 0);
  shifted.setDate(Math.min(day, lastDay.getDate()));
  return shifted;
}
function monthLabel(date: Date, language: string) { return new Intl.DateTimeFormat(language === "de" ? "de-CH" : language === "fr" ? "fr-CH" : language === "it" ? "it-CH" : "en-GB", { month: "long", year: "numeric" }).format(date); }
function localToIso(value: string) { return value.length === 16 ? `${value}:00` : value; }
function getRange(date: Date, view: View) {
  const start = new Date(date); start.setHours(0,0,0,0);
  const end = new Date(start);
  if (view === "week") {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    end.setTime(start.getTime()); end.setDate(end.getDate() + 6);
  } else if (view === "month") {
    start.setDate(1); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    end.setTime(start.getTime()); end.setDate(end.getDate() + 41);
  } else if (view === "year") {
    start.setMonth(0, 1); end.setMonth(11, 31);
  } else if (view === "list") {
    start.setDate(start.getDate() - 30); end.setDate(end.getDate() + 60);
  }
  return { from: `${dateInput(start)}T00:00:00`, to: `${dateInput(end)}T23:59:59` };
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(body.error ?? "The calendar request failed.");
  return body;
}

export function ChurchCalendarModule({ departmentId, csrfToken, department, canManageSite, language, realtime, onNavigateEntity, state, onStateChange }: ModuleContext) {
  const viewerPreference = displayPreference(state);
  const locationTimeZone = validNamedZone(department.timeZone) ?? "UTC";
  const deviceTimeZone = validNamedZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "UTC";
  const queryTimeZone = viewerPreference === "device" ? deviceTimeZone : viewerPreference;
  const viewerZone = queryTimeZone === "appointments" || queryTimeZone === "location" ? locationTimeZone : queryTimeZone;
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [archivedAppointments, setArchivedAppointments] = useState<ArchivedAppointment[]>([]);
  const [choices, setChoices] = useState<ChoiceSet>({ groups: [], signupGroups: [], events: [], resourceBookings: [], servicePlanTemplates: [], canSelectPeople: false });
  const [personSearch, setPersonSearch] = useState("");
  const [personChoices, setPersonChoices] = useState<PersonChoice[]>([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);
  const selectionLocation = useRef<string | null>(null);
  const [tagFilter, setTagFilter] = useState<{ departmentId: string; key: string; label: string }>();
  const [anchor, setAnchor] = useState(() => todayInZone(viewerZone));
  const [view, setView] = useState<View>("month");
  const [loading, setLoading] = useState(true);
  const [loadedPrintScope, setLoadedPrintScope] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showCalendarForm, setShowCalendarForm] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [reminderLead, setReminderLead] = useState(30);
  const [reminderClock, setReminderClock] = useState("09:00");
  const [reminderClockZone, setReminderClockZone] = useState(viewerZone);
  const [scope, setScope] = useState<"occurrence" | "future" | "series">("occurrence");
  const [draft, setDraft] = useState<Draft>(initialDraft());
  const [calendarName, setCalendarName] = useState("");
  const [calendarScope, setCalendarScope] = useState<Scope>("personal");
  const [groupId, setGroupId] = useState("");
  const [attendance, setAttendance] = useState<{ departmentId: string; target: GroupMeetingTarget }>();
  const [calendarColor, setCalendarColor] = useState("#3b82f6");
  const [extraStart, setExtraStart] = useState("");
  const [extraEnd, setExtraEnd] = useState("");
  const [extraDates, setExtraDates] = useState<ExtraDate[]>([]);
  const [registrationThrough, setRegistrationThrough] = useState("");
  const [registrationTemplateId, setRegistrationTemplateId] = useState("");
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
  const [issuedFeed, setIssuedFeed] = useState<{ url: string; departmentId: string; name: string; confidential: boolean } | null>(null);
  const canManageShared = canManageSite || (department.modulePermissions?.["church-calendar"] ?? []).includes("manage") || (department.permissions ?? []).some((permission) => ["events_manage", "groups_manage"].includes(permission));
  const canManageGroups = canManageSite || department.role === "site_admin" || (department.permissions ?? []).includes("groups_manage");
  const canManageEvents = canManageSite || department.role === "site_admin" || (department.permissions ?? []).includes("events_manage");
  const headers = useMemo(() => ({ "x-department-id": departmentId }), [departmentId]);
  const mutationHeaders = useMemo(() => ({ ...headers, "x-csrf-token": csrfToken, "content-type": "application/json" }), [headers, csrfToken]);
  const range = useMemo(() => getRange(anchor, view), [anchor, view]);
  const printScope = JSON.stringify([departmentId, range.from, range.to, queryTimeZone]);

  const loadVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true); setLoadedPrintScope(""); setError("");
    try {
      const [calendarRows, eventRows, choiceRows] = await Promise.all([
        api<Calendar[]>("/api/modules/church-calendar/calendars", { headers }),
        api<Appointment[]>(`/api/modules/church-calendar/appointments?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}&displayTimeZone=${encodeURIComponent(queryTimeZone)}`, { headers }),
        api<ChoiceSet>("/api/modules/church-calendar/choices", { headers }),
      ]);
      if (version !== loadVersion.current) return;
      setCalendars(calendarRows);
      setAppointments(eventRows);
      setLoadedPrintScope(printScope);
      setChoices(choiceRows);
      const firstLoadForLocation = selectionLocation.current !== departmentId;
      selectionLocation.current = departmentId;
      setSelectedCalendarIds((current) => firstLoadForLocation
        ? calendarRows.map((item) => item.id)
        : current.filter((id) => calendarRows.some((item) => item.id === id)));
    } catch (reason) {
      if (version === loadVersion.current) setError(reason instanceof Error ? reason.message : "Could not load the calendar.");
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [departmentId, headers, printScope, range.from, range.to, queryTimeZone]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => { void load(); };
    const unsubscribeCalendar = realtime?.subscribe("module:church-calendar:changed", refresh);
    const unsubscribeCore = realtime?.subscribe("core:data:changed", refresh);
    const unsubscribeResources = realtime?.subscribe("module:resource-scheduler:changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      unsubscribeCalendar?.();
      unsubscribeCore?.();
      unsubscribeResources?.();
      window.removeEventListener("focus", refresh);
    };
  }, [realtime, load]);
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
    if (!canManageEvents || !choices.canSelectPeople || eventStaffSearch.trim().length < 2) { setEventStaffChoices([]); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      void api<PersonChoice[]>(`/api/modules/church-calendar/people?q=${encodeURIComponent(eventStaffSearch.trim())}&staffing=true`, { headers })
        .then((rows) => { if (active) setEventStaffChoices(rows); })
        .catch(() => { if (active) setEventStaffChoices([]); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [canManageEvents, choices.canSelectPeople, eventStaffSearch, headers]);

  const selectedTag = tagFilter?.departmentId === departmentId ? tagFilter : undefined;
  const calendarAppointments = loadedPrintScope === printScope
    ? appointments.filter((item) => selectedCalendarIds.includes(item.calendarId))
    : [];
  const tagOptions = new Map<string, string>();
  for (const { tags } of calendarAppointments) {
    for (const tag of tags) {
      const key = tag.toLowerCase();
      if (!tagOptions.has(key)) tagOptions.set(key, tag);
    }
  }
  if (selectedTag && !tagOptions.has(selectedTag.key)) tagOptions.set(selectedTag.key, selectedTag.label);
  const visibleAppointments = selectedTag
    ? calendarAppointments.filter(({ tags }) => tags.some((tag) => tag.toLowerCase() === selectedTag.key))
    : calendarAppointments;
  const templateCalendar = calendars.find((calendar) => calendar.id === (editing?.calendarId ?? draft.calendarId));
  const canManageTemplates = templateCalendar?.scope === "personal" ? templateCalendar.isOwner
    : Boolean(templateCalendar && (canManageSite || (department.modulePermissions?.["church-calendar"] ?? []).includes("manage")
      || (department.permissions ?? []).includes("events_manage")
      || (templateCalendar.scope === "group" && (department.permissions ?? []).includes("groups_manage"))));
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
    setAnchor((current) => {
      if (view === "month" || view === "year") return shiftCalendarMonth(current, amount * (view === "year" ? 12 : 1));
      const next = new Date(current);
      next.setDate(next.getDate() + amount * (view === "day" ? 1 : 7));
      return next;
    });
  }
  function openNew(date?: Date) {
    const start = date ? new Date(date) : new Date(anchor);
    if (view === "month" || view === "year" || view === "list") start.setHours(18,0,0,0);
    const end = new Date(start); end.setMinutes(end.getMinutes()+60);
    setEditing(null); setExtraDates([]); setImageFile(null); setScope("series");
    setPersonSearch(""); setPersonChoices([]);
    setDraft({ ...initialDraft(), ...monthlyWeekdayParts(start), timeZone: viewerZone === locationTimeZone ? "" : viewerZone, calendarId: calendars.find((item) => item.scope === "personal" && item.isOwner)?.id ?? calendars.find((item) => item.scope === "community")?.id ?? calendars[0]?.id ?? "", startsAt: dateTimeInput(start), endsAt: dateTimeInput(end) });
    setShowForm(true);
  }
  async function openEdit(item: Appointment) {
    setEventRegistrationEnabled(false);
    setEventRegistrationCapacity("");
    setImageFile(null);
    setPersonSearch(item.responsiblePersonName ?? ""); setPersonChoices(item.responsibleContactId && item.responsiblePersonName ? [{ id: item.responsibleContactId, name: item.responsiblePersonName }] : []);
    setEditing(item); setReminderLead(item.reminder?.minutesBefore ?? 30);
    setReminderClock(item.reminder?.clockTime ?? "09:00");
    setReminderClockZone(validNamedZone(item.reminder?.clockTimeZone) ?? viewerZone);
    setScope(item.recurrence ? "occurrence" : "series"); setExtraStart(""); setExtraEnd("");
    setExtraDates([]);
    const seriesStart = new Date(`${item.seriesStartsAt.slice(0,10)}T00:00:00`);
    const maximumRegistrationDate = new Date(seriesStart); maximumRegistrationDate.setFullYear(maximumRegistrationDate.getFullYear() + 5);
    const registrationDefault = item.recurrence?.endsOn ? (item.recurrence.endsOn < dateInput(maximumRegistrationDate) ? item.recurrence.endsOn : dateInput(maximumRegistrationDate)) : (() => { const date = new Date(seriesStart); date.setFullYear(date.getFullYear() + 1); return dateInput(date); })();
    setRegistrationThrough(registrationDefault);
    setRegistrationTemplateId("");
    setDraft({ timeZone: item.seriesTimeZone ?? "", calendarId: item.calendarId, title: item.title, subtitle: item.subtitle, description: item.description, startsAt: item.occurrenceStartAt.slice(0,16), endsAt: item.occurrenceEndAt.slice(0,16), allDay: item.allDay, place: item.place, url: item.url, internalOnly: item.internalOnly, tags: item.tags.join(", "), repeat: Boolean(item.recurrence), frequency: item.recurrence?.frequency ?? "weekly", interval: item.recurrence?.interval ?? 1, weekdays: item.recurrence?.weekdays ?? [], weekday: item.recurrence?.weekday ?? new Date(`${item.occurrenceStartAt.slice(0,10)}T00:00:00`).getDay(), weekOfMonth: item.recurrence?.weekOfMonth ?? monthlyWeekdayParts(new Date(`${item.occurrenceStartAt.slice(0,10)}T00:00:00`)).weekOfMonth, endsOn: item.recurrence?.endsOn ?? "", count: item.recurrence?.count ? String(item.recurrence.count) : "", manualDates: item.recurrence?.dates?.join(", ") ?? "", linkedEventId: item.linkedEventId ?? "", resourceBookingIds: item.resourceBookingIds, signupGroupId: item.signupGroupId ?? "", responsibleContactId: item.responsibleContactId ?? "" });
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
    const payload = { timeZone: draft.timeZone || null, calendarId: draft.calendarId, title: draft.title.trim(), subtitle: draft.subtitle, description: draft.description, startsAt: localToIso(draft.startsAt), endsAt: localToIso(draft.endsAt), allDay: draft.allDay, place: draft.place, url: draft.url, internalOnly: draft.internalOnly, tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean), recurrence, linkedEventId: draft.linkedEventId || null, ...(!editing || scope === "future" || scope === "series" && draft.resourceBookingIds !== editing.resourceBookingIds
      ? { resourceBookingIds: draft.resourceBookingIds } : {}), signupGroupId: draft.signupGroupId || null, ...(choices.canSelectPeople ? { responsibleContactId: draft.responsibleContactId || null } : {}), ...(editing ? { occurrenceStartAt: editing.originalOccurrenceStartAt ?? editing.occurrenceStartAt } : {}) };
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
      const result = await api<{ created: number; alreadyLinked: number; skippedCancelled: number }>(`/api/modules/church-calendar/appointments/${editing.appointmentId}/registration-groups`, { method: "POST", headers: mutationHeaders, body: JSON.stringify({ throughDate: registrationThrough, templateGroupId: registrationTemplateId || undefined }) });
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

  async function changeReminder(remove = false) {
    if (!editing || busy) return;
    const appointmentId = editing.appointmentId;
    const original = editing.originalOccurrenceStartAt ?? editing.occurrenceStartAt;
    const endpoint = `/api/modules/church-calendar/appointments/${appointmentId}/reminder`;
    setBusy(true); setError(""); setNotice("");
    try {
      const reminder = remove
        ? (await api(`${endpoint}?occurrenceStartAt=${encodeURIComponent(original)}`, { method: "DELETE", headers: { ...headers, "x-csrf-token": csrfToken } }), null)
        : await api<NonNullable<Appointment["reminder"]>>(endpoint, {
          method: "PUT", headers: mutationHeaders,
          body: JSON.stringify({ occurrenceStartAt: original, ...(editing.allDay
            ? { clockTime: reminderClock, clockTimeZone: reminderClockZone } : { minutesBefore: reminderLead }) }),
        });
      setEditing((current) => current?.appointmentId === appointmentId && (current.originalOccurrenceStartAt ?? current.occurrenceStartAt) === original
        ? { ...current, reminder } : current);
      setNotice(remove ? "Calendar reminder removed." : "Your Calendar reminder is set.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the Calendar reminder.");
    } finally { setBusy(false); }
  }

  async function removeAppointmentImage() {
    if (!editing || busy || !editing.imageUrl) return;
    setBusy(true); setError("");
    try { await api(`/api/modules/church-calendar/appointments/${editing.appointmentId}/image`, { method: "DELETE", headers: mutationHeaders, body: "{}" }); setEditing({ ...editing, imageUrl: null }); setNotice("Appointment image removed."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not remove this image."); }
    finally { setBusy(false); }
  }

  async function removeAppointment() {
    if (!editing || busy) return;
    const confirmation = linkedResourceBookings.length || editing.recurrence
      ? "Remove this appointment? Review any resource bookings separately in Resource Scheduler."
      : "Remove this appointment?";
    if (!window.confirm(confirmation)) return;
    setBusy(true); setError("");
    try {
      await api(`/api/modules/church-calendar/appointments/${editing.appointmentId}?scope=${scope}&occurrenceStartAt=${encodeURIComponent(editing.originalOccurrenceStartAt ?? editing.occurrenceStartAt)}`, { method: "DELETE", headers: mutationHeaders });
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
    setBusy(true); setError(""); setIssuedFeed(null);
    try { const result = await api<{ url: string }>(`/api/modules/church-calendar/calendars/${calendar.id}/public-feed`, { method: "POST", headers: mutationHeaders, body: "{}" }); setIssuedFeed({ url: new URL(result.url, window.location.origin).toString(), departmentId, name: calendar.name, confidential: false }); setNotice(calendar.hasPublicFeed ? "Public feed link rotated. The previous link no longer works." : "Public feed link created."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create the public feed link."); }
    finally { setBusy(false); }
  }

  async function changeSubscription(calendar: Calendar, method: "POST" | "DELETE") {
    setBusy(true); setError(""); setNotice(""); setIssuedFeed(null);
    try {
      const result = await api<{ url?: string }>(`/api/modules/church-calendar/calendars/${calendar.id}/subscription`, { method, headers: mutationHeaders, body: "{}" });
      if (result.url) setIssuedFeed({ url: new URL(result.url, window.location.origin).toString(), departmentId, name: calendar.name, confidential: true });
      setNotice(method === "DELETE" ? "Calendar subscription revoked." : calendar.hasSubscription ? "Previous subscription link replaced." : "Calendar subscription created.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the subscription.");
    } finally { setBusy(false); }
  }

  async function copyFeed(url: string) {
    try { await navigator.clipboard.writeText(url); setNotice("Calendar link copied."); }
    catch { setError("Select and copy the calendar link."); }
  }

  async function revokePublicFeed(calendar: Calendar) {
    if (busy || !window.confirm(`Revoke the public feed for ${calendar.name}? Existing subscribers will stop receiving updates.`)) return;
    setBusy(true); setError(""); setIssuedFeed(null);
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

  const viewerTimeZones = [...new Set(["UTC", locationTimeZone, deviceTimeZone, ...(viewerPreference.includes("/") ? [viewerPreference] : []), ...namedTimeZones])];
  const timeZoneOptions = [...new Set([locationTimeZone, draft.timeZone, "UTC", ...namedTimeZones].filter(Boolean))];
  const zoneField = <label>Time zone<select value={draft.timeZone} disabled={Boolean(editing?.recurrence && scope === "occurrence")} onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })}>
    <option value="">Location time zone ({locationTimeZone})</option>
    {timeZoneOptions.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
  </select>{draft.repeat && <small>Repeat dates follow the clock in this time zone.</small>}</label>;
  const eventsForDay = (day: Date) => visibleAppointments.filter((event) => displayStart(event).slice(0,10) === dateInput(day));
  const monthGridStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1); monthGridStart.setDate(monthGridStart.getDate()-((monthGridStart.getDay()+6)%7));
  const locale = language;
  const clockFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }), [locale]);
  const timeLabel = (item: Appointment) => item.allDay ? "All day" : clockFormatter.format(new Date(`${displayStart(item)}Z`));

  function printCalendar() {
    if (loading || loadedPrintScope !== printScope) return;
    const output = calendarPrintDocument({
      view,
      title: selectedTag ? `Church calendar · ${selectedTag.label}` : "Church calendar",
      from: range.from.slice(0, 10),
      through: range.to.slice(0, 10),
      locale,
      calendarNames: calendars.filter((calendar) => selectedCalendarIds.includes(calendar.id)).map(({ name }) => name),
      appointments: visibleAppointments.map((item) => ({
        date: displayStart(item).slice(0, 10), time: timeLabel(item), title: item.title,
        subtitle: item.subtitle, calendarName: item.calendarName, place: item.place,
      })),
    });
    const preview = window.open("", "_blank");
    if (!preview) { setError("Allow pop-ups to open the calendar print preview."); return; }
    preview.opener = null;
    preview.document.open();
    preview.document.write(output);
    preview.document.close();
    preview.focus();
    preview.print();
  }
  const editedOccurrence = editing && appointments.find((item) => item.appointmentId === editing.appointmentId
    && (item.originalOccurrenceStartAt ?? item.occurrenceStartAt) === (editing.originalOccurrenceStartAt ?? editing.occurrenceStartAt));
  const canScheduleReminder = editing && department.enabledModules?.includes("notifications") && (editing.allDay
    ? editing.occurrenceStartAt.slice(0, 10) >= dateInput(todayInZone(viewerZone))
    : editing.startsAtUtc && Date.parse(editing.startsAtUtc) > Date.now());
  const reminderZones = [...new Set([reminderClockZone, viewerZone, ...viewerTimeZones])];
  const linkedResourceBookings = editedOccurrence?.resourceBookings ?? editing?.resourceBookings ?? [];
  function appointmentLinks(item: Appointment) {
    const occurrenceBookings = item.resourceBookings?.filter((booking) => booking.scope === "occurrence") ?? [];
    const approvedBookings = occurrenceBookings.filter((booking) => booking.status === "approved").length;
    const pendingBookings = occurrenceBookings.filter((booking) => booking.status === "requested").length;
    const registration = item.eventRegistration;
    const linkedEventId = item.linkedEventId;
    const signupGroupId = item.signupGroupId;
    const hasWaitlist = registration?.capacity != null && registration.registered >= registration.capacity;
    return <>
      {item.signupToken ? <a className="church-calendar-signup-link" href={`/join-group/${item.signupToken}`} target="_blank" rel="noreferrer">Sign up: {item.signupGroupName ?? "Group"}</a> : item.signupGroupName ? <span className="church-calendar-signup-link">Registration group: {item.signupGroupName}</span> : null}
      {signupGroupId && item.signupGroupName && item.canManage && onNavigateEntity && <button type="button" className="church-calendar-event-link" onClick={() => onNavigateEntity("group", signupGroupId)}>Open registration group</button>}
      {registration && <div className="church-calendar-registration">
        {registration.open ? <a className="church-calendar-signup-link" href={`/register/${registration.token}`} target="_blank" rel="noreferrer">{hasWaitlist ? "Join event waitlist" : "Register for event"}</a> : <span>Event registration closed</span>}
        <span>{registration.registered}{registration.capacity == null ? "" : ` of ${registration.capacity}`} registered{registration.waitlisted ? ` · ${registration.waitlisted} waitlisted` : ""}</span>
      </div>}
      {occurrenceBookings.length > 0 && <span className="church-calendar-signup-link">{approvedBookings + pendingBookings
        ? `${approvedBookings} confirmed · ${pendingBookings} pending resource bookings`
        : "Resource bookings declined or cancelled"}</span>}
      {item.linkedEventCancelled && <span className="church-calendar-signup-link">Linked event cancelled</span>}
      {linkedEventId && onNavigateEntity && <button type="button" className="church-calendar-event-link" aria-label={`Open event for ${item.title}`} onClick={() => onNavigateEntity("event", linkedEventId)}>Open linked event</button>}
    </>;
  }
  function appointmentButton(item: Appointment) {
    const authoredZoneLabel = viewerPreference === "appointments" && item.timeZone !== locationTimeZone ? item.timeZone : undefined;
    return (
      <div key={`${item.appointmentId}:${item.originalOccurrenceStartAt ?? item.occurrenceStartAt}`} className="church-calendar-appointment-entry">
        <button type="button" className="church-calendar-event" style={{ "--calendar-accent": calendars.find((calendar) => calendar.id === item.calendarId)?.color ?? "#3b82f6" } as CSSProperties} onClick={() => openEdit(item)}>
          <strong>{timeLabel(item)} {item.title}</strong>
          {!item.allDay && (authoredZoneLabel || item.timeShifted) && <small>{authoredZoneLabel}{authoredZoneLabel && item.timeShifted ? " · " : ""}{item.timeShifted ? "Adjusted for clock change" : ""}</small>}
          {item.place && <span><MapPin size={12} /> {item.place}</span>}
          {item.responsiblePersonName && <span className="church-calendar-responsible">On behalf of {item.responsiblePersonName}</span>}
        </button>
        {appointmentLinks(item)}
      </div>
    );
  }

  if (canManageGroups && attendance?.departmentId === departmentId) {
    return <GroupMeetingAttendance key={departmentId + ":" + attendance.target.id} target={attendance.target}
      departmentId={departmentId} csrfToken={csrfToken} onBack={() => setAttendance(undefined)} />;
  }
  return <main className="church-calendar-page">
    <header className="church-calendar-header"><div><span className="eyebrow">PLANNING</span><h1>Calendar</h1><p>Appointments across your community, groups and personal calendars.</p></div><div className="church-calendar-header-actions"><button type="button" className="button button-secondary" onClick={() => void toggleArchive()}>{showArchive ? "Hide archive" : "Archive"}</button><button type="button" className="button button-secondary" onClick={() => setShowCalendarForm(true)}><Plus size={15} /> New calendar</button><button type="button" className="button button-primary" onClick={() => openNew()}><Plus size={15} /> New appointment</button></div></header>
    {error && <div className="church-calendar-message church-calendar-error" role="alert">{error}</div>}{notice && <div className="church-calendar-message church-calendar-success" role="status">{notice}</div>}
    {showArchive && <section className="church-calendar-archive" aria-label="Archived appointments"><header><div><h2>Archived appointments</h2><p>Restore an appointment to return it to its calendar.</p></div><span>{archivedAppointments.length}</span></header>{archivedAppointments.length ? archivedAppointments.map((item) => <article key={item.appointmentId}><div><strong>{item.title}</strong><small>{item.calendarName} · {dayLabel(new Date(item.startsAt), language)}</small></div><button type="button" className="button button-secondary" onClick={() => void restoreAppointment(item.appointmentId)} disabled={busy}>Restore</button></article>) : <p className="church-calendar-empty">No archived appointments.</p>}</section>}
    <div className="church-calendar-layout"><aside className="church-calendar-sidebar"><div className="church-calendar-mini-head"><strong>{monthLabel(anchor, language)}</strong><button className="icon-button" aria-label="Previous month" type="button" onClick={() => setAnchor((date) => shiftCalendarMonth(date, -1))}><ChevronLeft size={15} /></button><button className="icon-button" aria-label="Next month" type="button" onClick={() => setAnchor((date) => shiftCalendarMonth(date, 1))}><ChevronRight size={15} /></button></div><div className="church-calendar-mini-grid">{weekDays.map((day) => <span key={day}>{day[0]}</span>)}{Array.from({ length: 42 }, (_, index) => { const day = new Date(monthGridStart); day.setDate(day.getDate()+index); return <button key={index} className={`${day.getMonth() === anchor.getMonth() ? "" : "outside"} ${dateInput(day) === dateInput(anchor) ? "selected" : ""}`} type="button" onClick={() => setAnchor(day)}>{day.getDate()}</button>; })}</div><button type="button" className="church-calendar-today" onClick={() => setAnchor(todayInZone(viewerZone))}>Today</button>
      <label className="church-calendar-display-zone">Display time zone
        <select value={viewerPreference} onChange={(event) => onStateChange(displayPreferencePrefix + event.target.value)}>
          <option value="appointments">Appointment time zones</option>
          <option value="location">Location ({locationTimeZone})</option>
          <option value="device">Device ({deviceTimeZone})</option>
          <optgroup label="Named time zones">{viewerTimeZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</optgroup>
        </select>
      </label>
      {tagOptions.size > 0 && <label className="church-calendar-tag-filter">Appointment tag
        <select value={selectedTag?.key ?? ""} onChange={(event) => {
          const key = event.target.value;
          setTagFilter(key ? { departmentId, key, label: tagOptions.get(key) ?? key } : undefined);
        }}>
          <option value="">All tags</option>
          {[...tagOptions].sort((left, right) => left[1].localeCompare(right[1], language)).map(([key, label]) =>
            <option key={key} value={key}>{label}</option>)}
        </select>
      </label>}
      <h2>My calendars</h2><div className="church-calendar-list">{calendars.map((calendar) => <label key={calendar.id}><input type="checkbox" checked={selectedCalendarIds.includes(calendar.id)} onChange={(event) => setSelectedCalendarIds((current) => event.target.checked ? [...current, calendar.id] : current.filter((id) => id !== calendar.id))} /><i style={{ background: calendar.color }} /><span>{calendar.name}</span><small>{calendar.scope === "personal" ? "Personal" : calendar.scope === "group" ? calendar.groupName ?? "Group" : "Community"}</small></label>)}</div>{canManageShared && calendars.filter((calendar) => calendar.scope === "community").length > 0 && <section className="church-calendar-public-feed-settings"><h2>Public calendar feeds</h2>{calendars.filter((calendar) => calendar.scope === "community").map((calendar) => <div key={calendar.id}><span>{calendar.name}</span>{calendar.hasPublicFeed ? <><small>Feed enabled</small><button type="button" className="church-calendar-feed-button" onClick={() => void issuePublicFeed(calendar)} disabled={busy}>Rotate link</button><button type="button" className="church-calendar-feed-button" onClick={() => void revokePublicFeed(calendar)} disabled={busy}>Revoke</button></> : <button type="button" className="church-calendar-feed-button" onClick={() => void issuePublicFeed(calendar)} disabled={busy}>Create feed link</button>}</div>)}</section>}{calendars.some((calendar) => calendar.canSubscribe || calendar.hasSubscription) && <section className="church-calendar-public-feed-settings">
        <h2>My calendar subscriptions</h2>
        {calendars.filter((calendar) => calendar.canSubscribe || calendar.hasSubscription).map((calendar) => <div key={calendar.id}>
          <span>{calendar.name}</span>
          {calendar.canSubscribe && <button type="button" className="church-calendar-feed-button" disabled={busy} onClick={() => void changeSubscription(calendar, "POST")}>{calendar.hasSubscription ? "Replace link" : "Create link"}</button>}
          {calendar.hasSubscription && <button type="button" className="church-calendar-feed-button" disabled={busy} onClick={() => void changeSubscription(calendar, "DELETE")}>Revoke</button>}
        </div>)}
      </section>}
      {issuedFeed?.departmentId === departmentId && <section className="church-calendar-feed-result" aria-label="Calendar link">
        <strong>{issuedFeed.name}</strong>
        <label>Calendar link <input value={issuedFeed.url} readOnly onFocus={(event) => event.target.select()} /></label>
        {issuedFeed.confidential && <small>Keep this link private. Anyone with it can read this feed while your access is active.</small>}
        <div className="church-calendar-feed-actions">
          <a href={issuedFeed.url.replace(/^https?:/, "webcal:")} referrerPolicy="no-referrer">Subscribe in calendar app</a>
          <button type="button" className="church-calendar-feed-button" onClick={() => void copyFeed(issuedFeed.url)}>Copy link</button>
          <a href={issuedFeed.url} download="calendar.ics" referrerPolicy="no-referrer">Download .ics</a>
        </div>
      </section>}{!calendars.length && !loading && <p className="church-calendar-empty">Create your first personal calendar or a shared calendar.</p>}</aside>
      <section className="church-calendar-main"><div className="church-calendar-toolbar"><div className="church-calendar-date-nav"><button type="button" className="icon-button" aria-label="Previous" onClick={() => move(-1)}><ChevronLeft size={18} /></button><button type="button" className="icon-button" aria-label="Next" onClick={() => move(1)}><ChevronRight size={18} /></button><h2>{view === "year" ? anchor.getFullYear() : monthLabel(anchor, language)}</h2><button type="button" className="church-calendar-today" onClick={() => setAnchor(new Date())}>Today</button></div><div className="church-calendar-views" role="group" aria-label="Calendar view">{(["day", "week", "month", "year", "list"] as View[]).map((item) => <button type="button" key={item} className={view === item ? "active" : ""} aria-pressed={view === item} onClick={() => setView(item)}>{item[0].toUpperCase()+item.slice(1)}</button>)}</div><button type="button" className="button button-secondary" disabled={loading || loadedPrintScope !== printScope} onClick={printCalendar}><Printer size={15} /> Print calendar</button></div>
        {loading ? <div className="church-calendar-loading"><RotateCcw size={18} className="spinning" /> Loading appointments…</div> : view === "month" ? <div className="church-calendar-month"><div className="church-calendar-weekdays">{["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day) => <span key={day}>{day}</span>)}</div><div className="church-calendar-month-grid">{Array.from({ length: 42 }, (_, index) => { const day = new Date(monthGridStart); day.setDate(day.getDate()+index); return <div key={index} className={`church-calendar-day ${day.getMonth() !== anchor.getMonth() ? "outside" : ""}`}><button className="church-calendar-day-number" type="button" onClick={() => { setAnchor(day); setView("day"); }}>{day.getDate()}</button>{eventsForDay(day).slice(0,4).map(appointmentButton)}{eventsForDay(day).length > 4 && <small>+{eventsForDay(day).length-4} more</small>}</div>; })}</div></div> : view === "week" || view === "day" ? <div className={`church-calendar-columns church-calendar-columns-${view}`}>{Array.from({ length: view === "day" ? 1 : 7 }, (_, index) => { const day = new Date(anchor); if (view === "week") day.setDate(day.getDate()-((day.getDay()+6)%7)+index); return <section key={index} className="church-calendar-column"><header><strong>{dayLabel(day, language)}</strong><button type="button" aria-label={`New appointment ${dateInput(day)}`} onClick={() => openNew(day)}><Plus size={14} /></button></header>{eventsForDay(day).map(appointmentButton)}{!eventsForDay(day).length && <button type="button" className="church-calendar-add-slot" onClick={() => openNew(day)}>Add appointment</button>}</section>; })}</div> : view === "year" ? <div className="church-calendar-year">{Array.from({ length: 12 }, (_, month) => { const first = new Date(anchor.getFullYear(), month, 1); const count = visibleAppointments.filter((event) => Number(displayStart(event).slice(5,7)) === month + 1).length; return <button type="button" key={month} onClick={() => { setAnchor(first); setView("month"); }}><strong>{new Intl.DateTimeFormat(locale, { month: "long" }).format(first)}</strong><span>{count} appointments</span></button>; })}</div> : <div className="church-calendar-list-view">{visibleAppointments.map((item) => <Fragment key={`${item.appointmentId}:${item.originalOccurrenceStartAt ?? item.occurrenceStartAt}`}><button type="button" onClick={() => openEdit(item)}><span className="church-calendar-list-date">{dayLabel(dateFromLocal(displayStart(item)), language)}</span><span className="church-calendar-list-title"><strong>{item.title}</strong><small>{item.calendarName}{item.place ? ` · ${item.place}` : ""}{item.responsiblePersonName ? ` · On behalf of ${item.responsiblePersonName}` : ""}</small></span><span>{timeLabel(item)}</span><ChevronRight size={16} /></button>{(item.signupGroupName || item.linkedEventId || item.resourceBookings?.some((booking) => booking.scope === "occurrence")) && <div className="church-calendar-list-links">{appointmentLinks(item)}</div>}</Fragment>)}</div>}
        {!loading && !visibleAppointments.length && <div className="church-calendar-empty-state"><CalendarDays size={28} /><strong>No appointments in this view</strong><span>{selectedTag ? "Choose another tag or date to show more appointments." : "Try another date or add an appointment."}</span><button type="button" className="button button-primary" onClick={() => openNew()}><Plus size={15} /> New appointment</button></div>}
      </section></div>
    {showCalendarForm && <div className="church-calendar-modal-backdrop" role="presentation"><section className="church-calendar-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-create-heading"><header><div><span className="eyebrow">CALENDAR SETUP</span><h2 id="calendar-create-heading">New calendar</h2></div><button className="icon-button" type="button" aria-label="Close" onClick={() => setShowCalendarForm(false)}><X size={18} /></button></header><form onSubmit={(event) => void createCalendar(event)}><label>Calendar name<input required maxLength={120} value={calendarName} onChange={(event) => setCalendarName(event.target.value)} /></label><label>Calendar type<select value={calendarScope} onChange={(event) => setCalendarScope(event.target.value as Scope)}><option value="personal">Personal</option>{canManageShared && <><option value="community">Community</option><option value="group">Group</option></>}</select></label>{calendarScope === "group" && <label>Group<select required value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">Choose group</option>{choices.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}<label>Color<input type="color" value={calendarColor} onChange={(event) => setCalendarColor(event.target.value)} /></label><footer><button type="button" className="button button-secondary" onClick={() => setShowCalendarForm(false)}>Cancel</button><button type="submit" className="button button-primary" disabled={busy || !calendarName.trim()}><Plus size={15} /> Create calendar</button></footer></form></section></div>}
    {showForm && <div className="church-calendar-modal-backdrop" role="presentation"><section className="church-calendar-modal church-calendar-appointment-modal" role="dialog" aria-modal="true" aria-labelledby="appointment-heading"><header><div><span className="eyebrow">{editing ? "APPOINTMENT DETAILS" : "NEW APPOINTMENT"}</span><h2 id="appointment-heading">{editing ? "Edit appointment" : "Create appointment"}</h2></div><button className="icon-button" type="button" aria-label="Close" onClick={() => setShowForm(false)}><X size={18} /></button></header><form onSubmit={(event) => void saveAppointment(event)}><div className="church-calendar-form-grid">
      {editing && (editing.reminder || canScheduleReminder) && <div className="church-calendar-extra-date wide">
        <strong>Remind me about this occurrence</strong>
        <small>{editing.reminder?.delivered ? "Reminder delivered to your Notifications." : editing.reminder ? "Personal reminder scheduled." : "Receive a reminder in your Notifications."}</small>
        <div>
          {canScheduleReminder && <>
            {editing.allDay ? <>
              <label>Reminder time<input type="time" value={reminderClock} disabled={busy} onChange={(event) => setReminderClock(event.target.value)} /></label>
              <label>Reminder time zone<select value={reminderClockZone} disabled={busy} onChange={(event) => setReminderClockZone(event.target.value)}>
                {reminderZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
              </select></label>
            </> : <label>Send reminder<select value={reminderLead} disabled={busy} onChange={(event) => setReminderLead(Number(event.target.value))}>
              <option value={5}>5 minutes before</option><option value={15}>15 minutes before</option>
              <option value={30}>30 minutes before</option><option value={60}>1 hour before</option><option value={1440}>1 day before</option>
            </select></label>}
            <button type="button" className="button button-secondary" disabled={busy || (editing.allDay && !reminderClock)} onClick={() => void changeReminder()}>{editing.reminder ? "Update reminder" : "Set reminder"}</button>
          </>}
          {editing.reminder && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void changeReminder(true)}>Remove reminder</button>}
        </div>
      </div>}
      {editing?.calendarScope === "group" && editing.groupId && canManageGroups && <CalendarGroupMeeting
        key={departmentId + ":" + editing.appointmentId + ":" + (editing.originalOccurrenceStartAt ?? editing.occurrenceStartAt)}
        appointmentId={editing.appointmentId} originalStart={editing.originalOccurrenceStartAt ?? editing.occurrenceStartAt}
        departmentId={departmentId} csrfToken={csrfToken} onOpen={(target) => setAttendance({ departmentId, target })}
      />}
      {linkedResourceBookings.length > 0 && <div className="church-calendar-extra-date wide">
        <strong>Resource bookings</strong>
        <ul className="church-calendar-extra-date-list">{linkedResourceBookings.map((booking) => <li key={booking.id}>
          <div><strong>{booking.name}</strong><br /><small>{booking.scope === "occurrence" ? "This occurrence" : "Entire appointment"} · {booking.status === "approved" ? "Confirmed" : booking.status === "requested" ? "Pending approval" : booking.status} · Setup {booking.leadInMinutes} min · Cleanup {booking.cleanupMinutes} min</small>
            {booking.timeMismatch && <p role="status">The booking time differs from the appointment. Review it in Resources.</p>}</div>
          {onNavigateEntity && <button className="button button-secondary" type="button" onClick={() => onNavigateEntity("booking", booking.id)}>Open booking</button>}
        </li>)}</ul>
      </div>}
      {editing?.canManage && editing.resourceWindow && editing.resourceWindow.endsAt > editing.resourceWindow.startsAt && editing.calendarScope !== "personal" && department.enabledModules?.includes("resource-scheduler") && (department.role === "site_admin" || (department.permissions ?? []).includes("resources_manage") || (department.modulePermissions?.["resource-scheduler"] ?? []).includes("manage")) && <CalendarResourceRequest
        key={departmentId + ":" + editing.appointmentId + ":" + editing.occurrenceStartAt}
        appointmentId={editing.appointmentId} occurrenceStartAt={editing.originalOccurrenceStartAt ?? editing.occurrenceStartAt}
        defaultPurpose={editing.calendarScope === "group" || editing.internalOnly ? "Calendar booking" : editing.title}
        startsAt={editing.resourceWindow.startsAt} endsAt={editing.resourceWindow.endsAt}
        headers={mutationHeaders} onCreated={() => { setNotice("Resource booking linked to this occurrence."); void load(); }}
      />}
{templateCalendar && canManageTemplates && (!editing || editing.canManage) &&
  <AppointmentTemplates key={`${departmentId}:${templateCalendar.id}:${editing?.appointmentId ?? "new"}:${editing?.occurrenceStartAt ?? ""}`}
    departmentId={departmentId} calendarId={templateCalendar.id} csrfToken={csrfToken} draft={editing ?? draft}
    apply={editing ? undefined : (template) => setDraft((current) => applyAppointmentTemplate(current, template))} />}
<label className="wide">Title<input required maxLength={160} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><label>Calendar<select required value={draft.calendarId} onChange={(event) => setDraft({ ...draft, calendarId: event.target.value })}>{calendars.filter((calendar) => calendar.scope === "personal" ? calendar.isOwner : canManageShared).map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</select></label><label>Subtitle<input maxLength={240} value={draft.subtitle} onChange={(event) => setDraft({ ...draft, subtitle: event.target.value })} /></label>{choices.canSelectPeople && <div className="church-calendar-person-picker"><label>On behalf of · search People<input type="search" minLength={2} maxLength={80} value={personSearch} onChange={(event) => { setPersonSearch(event.target.value); setDraft({ ...draft, responsibleContactId: "" }); }} placeholder="Enter a name" /></label><label>Person<select value={draft.responsibleContactId} onChange={(event) => setDraft({ ...draft, responsibleContactId: event.target.value })}><option value="">No person selected</option>{personChoices.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><small>Only People records in this location are available. Contact details are not shared with other calendar viewers.</small></div>}{zoneField}<label>Starts<input type="datetime-local" required value={draft.startsAt} onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })} /></label><label>Ends<input type="datetime-local" required value={draft.endsAt} onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })} /></label><label>Place<input maxLength={200} value={draft.place} onChange={(event) => setDraft({ ...draft, place: event.target.value })} /></label><label>Web link<input type="url" maxLength={1000} value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="https://" /></label><label>Appointment image<input type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={(event) => { const file = event.target.files?.[0] ?? null; if (file && file.size > 1048576) { setError("Choose an image smaller than 1 MiB."); setImageFile(null); } else { setError(""); setImageFile(file); } }} /><small>JPEG, PNG, GIF or WebP, up to 1 MiB.</small></label>{imageFile && <small className="wide">Selected: {imageFile.name}</small>}{editing?.imageUrl && <div className="church-calendar-image-preview wide"><img src={editing.imageUrl} alt="Current appointment" /><button type="button" className="button button-secondary" onClick={() => void removeAppointmentImage()} disabled={busy}>Remove image</button></div>}<label className="wide">Description<textarea rows={4} maxLength={8000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label><label>Tags<input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="Separate with commas" /></label><label>Link service/event<select value={draft.linkedEventId} onChange={(event) => setDraft({ ...draft, linkedEventId: event.target.value })}><option value="">No linked event</option>{choices.events.map((choice) => <option key={choice.id} value={choice.id}>{choice.event_date} · {choice.title}</option>)}</select></label><label>Group signup<select value={draft.signupGroupId} onChange={(event) => setDraft({ ...draft, signupGroupId: event.target.value })}><option value="">No signup link</option>{choices.signupGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><small>Existing public group signup page.</small></label>{(!editing?.recurrence || scope !== "occurrence") && <label>Link approved resource bookings to the appointment<select multiple value={draft.resourceBookingIds} onChange={(event) => setDraft({ ...draft, resourceBookingIds: Array.from(event.currentTarget.selectedOptions, (option) => option.value) })}>{choices.resourceBookings.map((booking) => <option key={booking.id} value={booking.id}>{booking.starts_at.slice(0,16).replace("T", " ")} · {booking.purpose}</option>)}</select><small>Hold Ctrl or Command to select multiple bookings.</small></label>}<label className="church-calendar-check"><input type="checkbox" checked={draft.allDay} onChange={(event) => setDraft({ ...draft, allDay: event.target.checked })} /> All day</label><label className="church-calendar-check"><input type="checkbox" checked={draft.internalOnly} onChange={(event) => setDraft({ ...draft, internalOnly: event.target.checked })} /> Internal appointment</label><label className="church-calendar-check wide"><input type="checkbox" checked={draft.repeat} onChange={(event) => setDraft({ ...draft, repeat: event.target.checked })} /><Repeat2 size={15} /> Repeat appointment</label>{draft.repeat && <div className="church-calendar-recurrence wide"><label>Repeat pattern<select value={draft.frequency} onChange={(event) => setDraft({ ...draft, frequency: event.target.value as Frequency })}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly by date</option><option value="monthly_weekday">Monthly by weekday</option><option value="yearly">Yearly</option><option value="manual">Manual dates</option></select></label><label>Every<input type="number" min={1} max={365} value={draft.interval} onChange={(event) => setDraft({ ...draft, interval: Number(event.target.value) })} /></label>{draft.frequency === "weekly" && <fieldset><legend>Days of week</legend>{weekDays.map((day, index) => <label key={day}><input type="checkbox" checked={draft.weekdays.includes(index)} onChange={(event) => setDraft({ ...draft, weekdays: event.target.checked ? [...draft.weekdays, index] : draft.weekdays.filter((value) => value !== index) })} />{day}</label>)}</fieldset>}{draft.frequency === "monthly_weekday" && <><label>Week of month<select value={draft.weekOfMonth} onChange={(event) => setDraft({ ...draft, weekOfMonth: Number(event.target.value) })}><option value={1}>First</option><option value={2}>Second</option><option value={3}>Third</option><option value={4}>Fourth</option><option value={-1}>Last</option></select></label><label>Weekday<select value={draft.weekday} onChange={(event) => setDraft({ ...draft, weekday: Number(event.target.value) })}>{weekDays.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label></>}{draft.frequency === "manual" && <div className="church-calendar-manual-dates"><label className="wide">Manual dates<input type="text" placeholder="YYYY-MM-DD, YYYY-MM-DD" value={draft.manualDates} onChange={(event) => setDraft({ ...draft, manualDates: event.target.value })} /><small>Enter up to 100 dates separated by commas.</small></label></div>}<label>End date<input type="date" value={draft.endsOn} onChange={(event) => setDraft({ ...draft, endsOn: event.target.value })} /></label><label>Or after occurrences<input type="number" min={1} max={500} value={draft.count} onChange={(event) => setDraft({ ...draft, count: event.target.value })} /></label></div>}{editing?.recurrence && <label className="wide">Apply changes<select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="occurrence">This appointment only</option><option value="future">This and following</option><option value="series">Entire series</option></select></label>}{editing?.recurrence && canManageGroups && <div className="church-calendar-extra-date wide"><strong>Generate registration groups</strong>
      {!!choices.registrationFormTemplates?.length && <label>Signup form template
        <select value={registrationTemplateId} onChange={(event) => setRegistrationTemplateId(event.target.value)}>
          <option value="">Start with an empty form</option>
          {choices.registrationFormTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>
        <small>Copies questions, heading, default role and capacity. Each new group uses review before admission.</small>
      </label>}
      <div><label>Generate through<input type="date" min={editing.seriesStartsAt.slice(0,10)} max={(() => { const date = new Date(`${editing.seriesStartsAt.slice(0,10)}T00:00:00`); date.setFullYear(date.getFullYear() + 5); return dateInput(date); })()} value={registrationThrough} onChange={(event) => setRegistrationThrough(event.target.value)} /></label><button type="button" className="button button-secondary" onClick={() => void generateRegistrationGroups()} disabled={!registrationThrough || busy}><Plus size={14} /> Generate groups</button></div><small>Creates an unpublished group for each occurrence through this date. Signup starts disabled. Up to 500 occurrences are processed.</small></div>}{editing?.recurrence && canManageEvents && <div className="church-calendar-extra-date wide"><strong>Generate service events from a template</strong><div><label>Service-plan template<select value={eventTemplateId} onChange={(event) => selectEventTemplate(event.target.value)}><option value="">Choose a template…</option>{choices.servicePlanTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>{choices.canSelectPeople && (selectedServiceTemplate?.positions?.length ?? 0) > 0 && <div className="church-calendar-staff-picker"><label className="wide">Search People to assign<input type="search" minLength={2} maxLength={80} value={eventStaffSearch} onChange={(event) => setEventStaffSearch(event.target.value)} placeholder="Enter at least two letters" /></label><div className="church-calendar-staff-roles">{selectedServiceTemplate!.positions.map((position, index) => <label className="church-calendar-staff-role" key={`${index}-${position.name}`}><span>{position.name}{position.category ? ` · ${position.category}` : ""}{position.qualificationIds?.length ? " · Qualified volunteers only" : ""}</span><select value={eventStaffAssignments[index] ?? ""} onChange={(event) => assignEventStaff(index, event.target.value)}><option value="">Unassigned</option>{eventStaffOptions.filter((person) => person.id === eventStaffAssignments[index] || (position.qualificationIds ?? []).every((id) => person.qualificationIds?.includes(id.toLowerCase()))).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>)}</div><small className="wide">Selected volunteers are assigned to the matching template role in every generated event. Leave a role unassigned to keep it open.</small></div>}<label>Event kind<select value={eventKind} onChange={(event) => setEventKind(event.target.value as typeof eventKind)}><option value="service">Service</option><option value="meeting">Meeting</option><option value="community">Community</option><option value="other">Other</option></select></label><label className="church-calendar-check"><input type="checkbox" checked={eventRegistrationEnabled} onChange={(event) => setEventRegistrationEnabled(event.target.checked)} /> Enable public event registration</label>{eventRegistrationEnabled && <label>Capacity per event<input type="number" min={1} max={100000} step={1} value={eventRegistrationCapacity} onChange={(event) => setEventRegistrationCapacity(event.target.value)} placeholder="Unlimited" /><small>Public registration requires a community appointment. Find each generated registration link in Services &amp; events.</small></label>}<label>Generate through<input type="date" min={editing.seriesStartsAt.slice(0,10)} max={(() => { const date = new Date(`${editing.seriesStartsAt.slice(0,10)}T00:00:00`); date.setFullYear(date.getFullYear() + 5); return dateInput(date); })()} value={eventGenerationThrough} onChange={(event) => setEventGenerationThrough(event.target.value)} /></label><button type="button" className="button button-secondary" onClick={() => void generateServiceEvents()} disabled={!eventGenerationThrough || !eventTemplateId || busy}><Plus size={14} /> Preview and generate</button></div><small>Shows a preview before creating events. Existing links and cancelled occurrences are skipped. Up to 500 occurrences are processed.</small></div>}{editing?.recurrence && <div className="church-calendar-extra-date wide"><strong>Add an extra date to this series</strong><div><input aria-label="Extra date starts" type="datetime-local" value={extraStart} onChange={(event) => setExtraStart(event.target.value)} /><input aria-label="Extra date ends" type="datetime-local" value={extraEnd} onChange={(event) => setExtraEnd(event.target.value)} /><button type="button" className="button button-secondary" onClick={() => void addExtraDate()} disabled={!extraStart || !extraEnd || busy}><Plus size={14} /> Add date</button></div>{extraDates.length ? <ul className="church-calendar-extra-date-list">{extraDates.map((date) => <li key={date.startsAt}><span>{date.startsAt.replace("T", " ").slice(0,16)} – {date.endsAt.slice(11,16)}</span><button type="button" className="button button-secondary" onClick={() => void removeExtraDate(date)} disabled={busy}>Remove</button></li>)}</ul> : <small>No extra dates have been added.</small>}</div>}</div><footer>{editing?.canManage && <button type="button" className="button button-danger" onClick={() => void removeAppointment()} disabled={busy}><Trash2 size={15} /> Remove</button>}<span /><button type="button" className="button button-secondary" onClick={() => setShowForm(false)}>Cancel</button><button type="submit" className="button button-primary" disabled={busy || !draft.title.trim() || !draft.calendarId}><Plus size={15} /> {busy ? "Saving…" : editing ? "Save changes" : "Create appointment"}</button></footer></form></section></div>}
  </main>;
}
