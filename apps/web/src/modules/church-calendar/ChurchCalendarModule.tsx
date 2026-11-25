import { CalendarRemoval } from "./CalendarRemoval";
import { CalendarBookingDecision } from "./CalendarBookingDecision";
import { CalendarDraftResources, type CalendarDraftResource } from "./CalendarDraftResources";
import { NewAppointmentImage, SavedAppointmentImage, emptyAppointmentImageMetadata } from "./AppointmentImage";
import { CalendarEmailUpdates } from "./CalendarEmailUpdates";
import { CalendarTimeGrid } from "./CalendarTimeGrid";
import { CalendarBookingDescription } from "./CalendarBookingDescription";
import { CalendarEmbedCode } from "./CalendarEmbedCode";
import { CalendarPublicAgendas } from "./CalendarPublicAgendas";
import { CalendarTagManager, type CalendarTagDefinition } from "./CalendarTagManager";
import { CalendarMeetingRequests } from "./CalendarMeetingRequests";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, Pencil, Plus, Printer, Repeat2, RotateCcw, Trash2, X } from "lucide-react";
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
type Calendar = { id: string; name: string; scope: Scope; groupId: string | null; groupName?: string; ownerUserId: string | null; color: string; sortOrder?: number; isOwner?: boolean; canManage?: boolean; canCreateAppointment?: boolean; allowMemberAppointments?: boolean; defaultServicePlanTemplateId?: string | null; hasPublicFeed?: boolean; canSubscribe?: boolean; hasSubscription?: boolean };
type Frequency = "daily" | "weekly" | "monthly" | "monthly_weekday" | "yearly" | "manual";
type Recurrence = { frequency: Frequency; interval: number; weekdays: number[]; weekday?: number; weekOfMonth?: number; endsOn?: string; count?: number; dates?: string[] };
type EventRegistration = { token: string; capacity: number | null; open: boolean; registered: number; waitlisted: number };
type LinkedResourceBooking = {
  id: string; name: string; status: string; scope: "series" | "occurrence";
  leadInMinutes: number; cleanupMinutes: number; timeMismatch?: boolean; canManageStatus?: boolean;
};
type MeetingRequestScope = "all" | "mine" | "invitations";
const requestLabels = { pending: "Awaiting response", accepted: "Accepted", declined: "Declined" } as const;
type Appointment = {
  myMeetingResponse?: keyof typeof requestLabels;
  appointmentId: string; occurrenceStartAt: string; occurrenceEndAt: string; originalOccurrenceStartAt?: string; seriesTimeZone?: string | null; timeZone?: string; startsAtUtc?: string | null; timeShifted?: boolean; seriesStartsAt: string; calendarId: string; calendarName: string; calendarScope: Scope;
  groupId?: string | null; title: string; subtitle: string; description: string; allDay: boolean; place: string; url: string;
  internalOnly: boolean; tags: string[]; recurrence: Recurrence | null; linkedEventId: string | null; resourceBookingIds: string[]; canManage: boolean;
  viewStartsAt?: string; viewEndsAt?: string; viewTimeZone?: string;
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

export function ChurchCalendarModule({ departmentId, accountId, csrfToken, department, canManageSite, language, realtime, onNavigateEntity, state, onStateChange, calendarAppointmentNavigation, onCalendarAppointmentOpened }: ModuleContext) {
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
  const [tagDefinitions, setTagDefinitions] = useState<{ departmentId: string; rows: CalendarTagDefinition[] }>();
  const [tagManagerDepartment, setTagManagerDepartment] = useState<string>();
  const [tagRevision, setTagRevision] = useState(0);
  const [tagFilter, setTagFilter] = useState<{ departmentId: string; tags: Map<string, string> }>();
  const [tagSearch, setTagSearch] = useState<{ departmentId: string; value: string }>();
  const [anchor, setAnchor] = useState(() => todayInZone(viewerZone));
  const [requestPreference, setRequestPreference] = useState<{ departmentId: string; accountId?: string; scope: MeetingRequestScope }>();
  const requestPreferenceKey = accountId ? `smart-church-calendar-request-view:${accountId}:${departmentId}` : undefined;
  const savedRequestPreference = useMemo((): MeetingRequestScope => {
    try {
      const value = requestPreferenceKey && localStorage.getItem(requestPreferenceKey);
      if (value === "mine" || value === "invitations") return value;
    } catch { /* Calendar works without browser storage. */ }
    return "all";
  }, [requestPreferenceKey]);
  const meetingRequests = requestPreference?.departmentId === departmentId && requestPreference.accountId === accountId
    ? requestPreference.scope : savedRequestPreference;
  function selectMeetingRequestScope(scope: MeetingRequestScope) {
    setRequestPreference({ departmentId, accountId, scope });
    if (requestPreferenceKey) {
      try { localStorage.setItem(requestPreferenceKey, scope); } catch { /* Keep the in-memory selection. */ }
    }
  }
  const [view, setView] = useState<View>("month");
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [createEventTemplateId, setCreateEventTemplateId] = useState("");
  const [newResourceBookings, setNewResourceBookings] = useState<CalendarDraftResource[]>([]);
  const layoutScope = JSON.stringify([accountId, departmentId]);
  const layoutKey = accountId ? "smart-church-calendar-compact:" + layoutScope : undefined;
  const [layout, setLayout] = useState<{ scope: string; compact: boolean }>();
  const savedCompact = useMemo(() => {
    try { return !!layoutKey && localStorage.getItem(layoutKey) === "true"; } catch { return false; }
  }, [layoutKey]);
  const compact = layout?.scope === layoutScope ? layout.compact : savedCompact;
  const dayOrWeek = view === "day" || view === "week";
  const showTimeGrid = dayOrWeek && !compact;
  function setCompact(value: boolean) {
    setLayout({ scope: layoutScope, compact: value });
    if (layoutKey) {
      try { localStorage.setItem(layoutKey, String(value)); } catch { /* Keep the in-memory selection. */ }
    }
  }
  const [loading, setLoading] = useState(true);
  const [loadedPrintScope, setLoadedPrintScope] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showCalendarForm, setShowCalendarForm] = useState(false);
  const [calendarEdit, setCalendarEdit] = useState<{ departmentId: string; id: string; name: string; color: string; sortOrder: string; allowMemberAppointments?: boolean; defaultServicePlanTemplateId?: string | null; initialDefaultServicePlanTemplateId?: string | null } | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [notifyCreator, setNotifyCreator] = useState(false);
  const [reminderLead, setReminderLead] = useState(30);
  const [reminderClock, setReminderClock] = useState("09:00");
  const [reminderClockZone, setReminderClockZone] = useState(viewerZone);
  const [scope, setScope] = useState<"occurrence" | "future" | "series">("occurrence");
  const [draft, setDraft] = useState<Draft>(initialDraft());
  const [calendarName, setCalendarName] = useState("");
  const [calendarSortOrder, setCalendarSortOrder] = useState("0");
  const [allowMemberAppointments, setAllowMemberAppointments] = useState(false);
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
  const [imageMetadata, setImageMetadata] = useState(emptyAppointmentImageMetadata);
  const [issuedFeed, setIssuedFeed] = useState<{ url: string; embedUrl?: string; departmentId: string; name: string; confidential: boolean } | null>(null);
  const canManageShared = canManageSite || (department.modulePermissions?.["church-calendar"] ?? []).includes("manage") || (department.permissions ?? []).some((permission) => ["events_manage", "groups_manage"].includes(permission));
  const canManageGroups = canManageSite || department.role === "site_admin" || (department.permissions ?? []).includes("groups_manage");
  const canManageEvents = canManageSite || department.role === "site_admin" || (department.permissions ?? []).includes("events_manage");
  const headers = useMemo(() => ({ "x-department-id": departmentId }), [departmentId]);
  const mutationHeaders = useMemo(() => ({ ...headers, "x-csrf-token": csrfToken, "content-type": "application/json" }), [headers, csrfToken]);
  const range = useMemo(() => getRange(anchor, view), [anchor, view]);
  const printScope = JSON.stringify([departmentId, accountId, range.from, range.to, queryTimeZone, meetingRequests, showTimeGrid]);

  const loadVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true); setLoadedPrintScope(""); setError("");
    try {
      const [calendarRows, eventRows, choiceRows] = await Promise.all([
        api<Calendar[]>("/api/modules/church-calendar/calendars", { headers }),
        api<Appointment[]>(`/api/modules/church-calendar/appointments?${new URLSearchParams({
          from: range.from, to: range.to, displayTimeZone: queryTimeZone,
          ...(showTimeGrid ? { includeOverlapping: "true" } : {}),
          ...(meetingRequests === "all" ? {} : { meetingRequests }),
        })}`, { headers }),
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
  }, [departmentId, headers, printScope, range.from, range.to, queryTimeZone, meetingRequests, showTimeGrid]);

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

  const canManageTags = canManageSite || department.role === "site_admin" || (department.permissions ?? []).includes("events_manage")
    || (department.modulePermissions?.["church-calendar"] ?? []).includes("manage");
  const activeTagDefinitions = tagDefinitions?.departmentId === departmentId ? tagDefinitions.rows : [];
  const definitionsByKey = new Map(activeTagDefinitions.map((tag) => [tag.key, tag]));
  useEffect(() => {
    const controller = new AbortController();
    let latest = 0;
    const refresh = () => {
      const version = ++latest;
      void api<CalendarTagDefinition[]>("/api/modules/church-calendar/tag-definitions", { headers, signal: controller.signal })
        .then((rows) => { if (!controller.signal.aborted && version === latest && Array.isArray(rows)) setTagDefinitions({ departmentId, rows }); })
        .catch(() => {});
    };
    refresh();
    const unsubscribe = realtime?.subscribe("module:church-calendar:changed", refresh);
    return () => { controller.abort(); unsubscribe?.(); };
  }, [departmentId, headers, realtime, tagRevision]);

  const selectedTags = tagFilter?.departmentId === departmentId ? tagFilter.tags : undefined;
  const tagSearchText = tagSearch?.departmentId === departmentId ? tagSearch.value : "";
  const tagQuery = tagSearchText.trim().toLowerCase();
  const calendarAppointments = loadedPrintScope === printScope
    ? appointments.filter((item) => selectedCalendarIds.includes(item.calendarId))
    : [];
  const tagOptions = new Map(activeTagDefinitions.map((tag) => [tag.key, tag.name]));
  const visibleTagCounts = new Map<string, Set<string>>();
  for (const { tags, appointmentId } of calendarAppointments) {
    for (const tag of tags) {
      const key = tag.toLowerCase();
      if (!tagOptions.has(key)) tagOptions.set(key, tag);
      const seen = visibleTagCounts.get(key) ?? new Set<string>();
      seen.add(appointmentId);
      visibleTagCounts.set(key, seen);
    }
  }
  for (const [key, label] of selectedTags ?? []) {
    if (!tagOptions.has(key)) tagOptions.set(key, label);
  }
  const filteredTagOptions = [...tagOptions]
    .filter(([key, label]) => !tagQuery || key.includes(tagQuery) || label.toLowerCase().includes(tagQuery) || selectedTags?.has(key))
    .sort((left, right) => left[1].localeCompare(right[1], language));
  const visibleAppointments = selectedTags?.size
    ? calendarAppointments.filter(({ tags }) => tags.some((tag) => selectedTags.has(tag.toLowerCase())))
    : calendarAppointments;

  function toggleTag(key: string, label: string, checked: boolean) {
    setTagFilter((current) => {
      const tags = new Map(current?.departmentId === departmentId ? current.tags : undefined);
      if (checked) tags.set(key, label);
      else tags.delete(key);
      return { departmentId, tags };
    });
  }
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
  const writableCalendars = selectionLocation.current === departmentId ? calendars.filter((calendar) => calendar.canCreateAppointment) : [];
  const draftCalendar = writableCalendars.find((calendar) => calendar.id === draft.calendarId);
  const contributorDraft = !editing && !!draftCalendar && !draftCalendar.canManage;
  const canBookWithDraft = !editing && draftCalendar?.canManage && draftCalendar.scope !== "personal"
    && !!department.enabledModules?.includes("resource-scheduler");
  const canCreateEventWithAppointment = !editing && canManageEvents && !!department.enabledModules?.includes("community")
    && draftCalendar?.scope === "community" && draftCalendar.canManage && !draft.repeat && !draft.internalOnly && !draft.linkedEventId
    && choices.servicePlanTemplates.length > 0;

  function openNew(date?: Date) {
    if (!writableCalendars.length) {
      setError("You do not have a calendar that accepts new appointments in this location.");
      return;
    }
    const start = date ? new Date(date) : new Date(anchor);
    if (view === "month" || view === "year" || view === "list") start.setHours(18,0,0,0);
    const end = new Date(start); end.setMinutes(end.getMinutes()+60);
    setEditing(null); setConfirmRemoval(false); setCreateEventTemplateId(""); setNewResourceBookings([]); setNotifyCreator(false); setExtraDates([]); setImageFile(null); setScope("series");
    setPersonSearch(""); setPersonChoices([]);
    setDraft({ ...initialDraft(), ...monthlyWeekdayParts(start), timeZone: viewerZone === locationTimeZone ? "" : viewerZone, calendarId: writableCalendars.find((item) => item.scope === "personal" && item.isOwner)?.id ?? writableCalendars.find((item) => item.scope === "community")?.id ?? writableCalendars[0].id, startsAt: dateTimeInput(start), endsAt: dateTimeInput(end) });
    setShowForm(true);
  }
  async function openEdit(item: Appointment) {
    setConfirmRemoval(false);
    const defaultTemplateId = calendars.find((calendar) => calendar.id === item.calendarId)?.defaultServicePlanTemplateId;
    selectEventTemplate(defaultTemplateId && item.canManage && item.recurrence && choices.servicePlanTemplates.some((template) => template.id === defaultTemplateId) ? defaultTemplateId : "");
    setEventRegistrationEnabled(false);
    setEventRegistrationCapacity("");
    setNewResourceBookings([]);
    setImageFile(null);
    setPersonSearch(item.responsiblePersonName ?? ""); setPersonChoices(item.responsibleContactId && item.responsiblePersonName ? [{ id: item.responsibleContactId, name: item.responsiblePersonName }] : []);
    setEditing(item); setNotifyCreator(false); setReminderLead(item.reminder?.minutesBefore ?? 30);
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

  const handledCalendarOpen = useRef<number | null>(null);
  const latestCalendarOpen = useRef(calendarAppointmentNavigation);
  latestCalendarOpen.current = calendarAppointmentNavigation?.departmentId === departmentId ? calendarAppointmentNavigation : null;

  useEffect(() => {
    const target = calendarAppointmentNavigation;
    if (!target || target.departmentId !== departmentId || handledCalendarOpen.current === target.requestId) return;
    const date = new Date(`${target.date}T12:00:00`);
    if (!Number.isFinite(date.getTime())) {
      handledCalendarOpen.current = target.requestId;
      onCalendarAppointmentOpened?.(target.requestId);
      return;
    }
    if (view !== "list" || dateInput(anchor) !== target.date) {
      setAnchor(date);
      setView("list");
      return;
    }
    if (loading || loadedPrintScope !== printScope) return;
    handledCalendarOpen.current = target.requestId;
    const matchesTarget = (item: Appointment) => item.appointmentId === target.appointmentId
      && (item.originalOccurrenceStartAt ?? item.occurrenceStartAt) === target.originalStartAt;
    const showAppointment = (occurrence?: Appointment) => {
      if (latestCalendarOpen.current?.requestId !== target.requestId) return;
      onCalendarAppointmentOpened?.(target.requestId);
      if (occurrence) void openEdit(occurrence);
      else setError("The linked appointment is no longer available.");
    };
    const occurrence = appointments.find(matchesTarget);
    if (occurrence) showAppointment(occurrence);
    else {
      // A busy calendar range may omit the target from the normal list.
      const params = new URLSearchParams({ ...range, displayTimeZone: queryTimeZone, appointmentId: target.appointmentId });
      void api<Appointment[]>(`/api/modules/church-calendar/appointments?${params}`, { headers })
        .then((items) => showAppointment(items.find(matchesTarget)))
        .catch(() => showAppointment());
    }
  }, [anchor, appointments, calendarAppointmentNavigation, departmentId, headers, loadedPrintScope, loading,
      onCalendarAppointmentOpened, openEdit, printScope, queryTimeZone, range, view]);

  async function saveAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(""); setNotice("");
    const manualDates = draft.manualDates.split(",").map((date) => date.trim()).filter(Boolean);
    const recurrence: Recurrence | null = draft.repeat ? { frequency: draft.frequency, interval: draft.interval, weekdays: draft.frequency === "weekly" ? draft.weekdays : [], ...(draft.frequency === "monthly_weekday" ? { weekday: draft.weekday, weekOfMonth: draft.weekOfMonth } : {}), ...(draft.endsOn ? { endsOn: draft.endsOn } : {}), ...(draft.count ? { count: Number(draft.count) } : {}), ...(draft.frequency === "manual" ? { dates: manualDates } : {}) } : null;
    const payload = { timeZone: draft.timeZone || null, calendarId: draft.calendarId, title: draft.title.trim(), subtitle: draft.subtitle, description: draft.description, startsAt: localToIso(draft.startsAt), endsAt: localToIso(draft.endsAt), allDay: draft.allDay, place: draft.place, url: draft.url, internalOnly: draft.internalOnly, tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean), recurrence, ...(!contributorDraft ? {
      linkedEventId: draft.linkedEventId || null,
      ...(canBookWithDraft && newResourceBookings.length ? { newResourceBookings } : {}),
      ...(canCreateEventWithAppointment && createEventTemplateId && choices.servicePlanTemplates.some(({ id }) => id === createEventTemplateId)
        ? { createEventTemplateId } : {}),
      ...(!editing || scope === "future" || scope === "series" && draft.resourceBookingIds !== editing.resourceBookingIds ? { resourceBookingIds: draft.resourceBookingIds } : {}),
      signupGroupId: draft.signupGroupId || null,
      ...(choices.canSelectPeople ? { responsibleContactId: draft.responsibleContactId || null } : {}),
    } : {}), ...(editing ? { occurrenceStartAt: editing.originalOccurrenceStartAt ?? editing.occurrenceStartAt, ...(editing.canManage && notifyCreator ? { notifyCreator } : {}) } : {}) };
    try {
      let appointmentId = editing?.appointmentId;
      let creatorNotificationQueued = false;
      let createdEventId: string | undefined;
      let bookings: Array<{ status: "requested" | "approved"; occurrenceStart: string }> | undefined;
      if (editing) ({ creatorNotificationQueued = false } = await api<{ creatorNotificationQueued?: boolean }>(`/api/modules/church-calendar/appointments/${editing.appointmentId}?scope=${scope}`, { method: "PUT", headers: mutationHeaders, body: JSON.stringify(payload) }));
      else {
        const created = await api<{ id: string; linkedEventId?: string; bookings?: Array<{ status: "requested" | "approved"; occurrenceStart: string }> }>("/api/modules/church-calendar/appointments", {
          method: "POST", headers: mutationHeaders, body: JSON.stringify(payload),
        });
        appointmentId = created.id;
        createdEventId = created.linkedEventId;
        bookings = created.bookings;
      }
      if (!contributorDraft && imageFile && appointmentId) {
        const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.onerror = () => reject(new Error("Could not read the appointment image.")); reader.readAsDataURL(imageFile); });
        await api(`/api/modules/church-calendar/appointments/${appointmentId}/image`, { method: "PUT", headers: mutationHeaders, body: JSON.stringify({ filename: imageFile.name, contentType: imageFile.type, data, metadata: imageMetadata }) });
      }
      const pending = bookings?.filter(({ status }) => status === "requested").length ?? 0;
      const approved = (bookings?.length ?? 0) - pending;
      const bookedDates = new Set(bookings?.map(({ occurrenceStart }) => occurrenceStart)).size;
      const bookingNotice = bookings?.length ? " Resources: " + approved + " confirmed, " + pending + " pending"
        + (bookedDates > 1 ? " across " + bookedDates + " occurrences." : ".") : "";
      setNotice(editing ? (notifyCreator ? (creatorNotificationQueued ? "Appointment updated. Creator notification queued." : "Appointment updated. No creator notification was queued.") : "Appointment updated.") : (createdEventId ? "Appointment and linked service event created." : "Appointment created.") + bookingNotice); setShowForm(false); await load();
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
      const created = await api<Calendar>("/api/modules/church-calendar/calendars", { method: "POST", headers: mutationHeaders, body: JSON.stringify({ name: calendarName, scope: calendarScope, ...(calendarScope === "group" ? { groupId, allowMemberAppointments } : {}), color: calendarColor, sortOrder: Number(calendarSortOrder) }) });
      setCalendarName(""); setGroupId(""); setCalendarSortOrder("0"); setAllowMemberAppointments(false); setShowCalendarForm(false); await load(); setSelectedCalendarIds((current) => [...new Set([...current, created.id])]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create this calendar."); }
    finally { setBusy(false); }
  }

  async function saveCalendarDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || calendarEdit?.departmentId !== departmentId || !calendarEdit.name.trim()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const { id, name, color, sortOrder, allowMemberAppointments, defaultServicePlanTemplateId } = calendarEdit;
      await api(`/api/modules/church-calendar/calendars/${id}`, {
        method: "PATCH", headers: mutationHeaders, body: JSON.stringify({ name, color, sortOrder: Number(sortOrder), allowMemberAppointments,
          ...(defaultServicePlanTemplateId !== calendarEdit.initialDefaultServicePlanTemplateId ? { defaultServicePlanTemplateId } : {}),
        }),
      });
      setCalendarEdit(null);
      setNotice("Calendar details saved.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save calendar details.");
    } finally {
      setBusy(false);
    }
  }

  async function issuePublicFeed(calendar: Calendar) {
    if (busy) return;
    setBusy(true); setError(""); setIssuedFeed(null);
    try { const result = await api<{ url: string; embedUrl?: string }>(`/api/modules/church-calendar/calendars/${calendar.id}/public-feed`, { method: "POST", headers: mutationHeaders, body: "{}" }); setIssuedFeed({ url: new URL(result.url, window.location.origin).toString(), ...(result.embedUrl ? { embedUrl: new URL(result.embedUrl, window.location.origin).toString() } : {}), departmentId, name: calendar.name, confidential: false }); setNotice(calendar.hasPublicFeed ? "Public feed link rotated. The previous link no longer works." : "Public feed link created."); await load(); }
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

  async function copyFeed(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice("Calendar link copied."); }
    catch { setError("Select and copy the calendar link."); }
  }

  async function revokePublicFeed(calendar: Calendar) {
    if (busy || !window.confirm(`Revoke the public feed for ${calendar.name}? Existing subscriptions and website embeds will stop working.`)) return;
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
    const printParts = ["Church calendar"];
    if (meetingRequests === "mine") printParts.push("Only my meeting requests");
    if (meetingRequests === "invitations") printParts.push("My invitations");
    if (selectedTags?.size) printParts.push(selectedTags.size <= 3
      ? [...selectedTags].map(([key, label]) => definitionsByKey.get(key)?.name ?? label).join(", ")
      : `${selectedTags.size} selected tags`);
    const output = calendarPrintDocument({
      view,
      title: printParts.join(" · "),
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
  const canManageCalendarResources = Boolean(editing?.canManage && editing.calendarScope !== "personal" && department.enabledModules?.includes("resource-scheduler")
    && (department.role === "site_admin" || (department.permissions ?? []).includes("resources_manage") || (department.modulePermissions?.["resource-scheduler"] ?? []).includes("manage")));
  const linkedResourceBookings = editedOccurrence?.resourceBookings ?? editing?.resourceBookings ?? [];
  function appointmentLinks(item: Appointment, showBookingSummary = true) {
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
      {showBookingSummary && occurrenceBookings.length > 0 && <span className="church-calendar-signup-link">{approvedBookings + pendingBookings
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
          {item.myMeetingResponse && <small>Meeting request · {requestLabels[item.myMeetingResponse]}</small>}
          {item.place && <span><MapPin size={12} /> {item.place}</span>}
          {item.responsiblePersonName && <span className="church-calendar-responsible">On behalf of {item.responsiblePersonName}</span>}
        </button>
        {appointmentLinks(item)}
      </div>
    );
  }

  if (canManageGroups && attendance?.departmentId === departmentId) {
    return <GroupMeetingAttendance key={departmentId + ":" + attendance.target.id} target={attendance.target}
      departmentId={departmentId} csrfToken={csrfToken} realtime={realtime} onBack={() => setAttendance(undefined)} />;
  }
  return <main className="church-calendar-page">
    <header className="church-calendar-header"><div><span className="eyebrow">PLANNING</span><h1>Calendar</h1><p>Appointments across your community, groups and personal calendars.</p></div><div className="church-calendar-header-actions"><button type="button" className="button button-secondary" onClick={() => void toggleArchive()}>{showArchive ? "Hide archive" : "Archive"}</button><button type="button" className="button button-secondary" onClick={() => setShowCalendarForm(true)}><Plus size={15} /> New calendar</button><button type="button" className="button button-primary" onClick={() => openNew()}><Plus size={15} /> New appointment</button></div></header>
    {error && <div className="church-calendar-message church-calendar-error" role="alert">{error}</div>}{notice && <div className="church-calendar-message church-calendar-success" role="status">{notice}</div>}
    {showArchive && <section className="church-calendar-archive" aria-label="Archived appointments"><header><div><h2>Archived appointments</h2><p>Restore an appointment to return it to its calendar.</p></div><span>{archivedAppointments.length}</span></header>{archivedAppointments.length ? archivedAppointments.map((item) => <article key={item.appointmentId}><div><strong>{item.title}</strong><small>{item.calendarName} · {dayLabel(new Date(item.startsAt), language)}</small></div><button type="button" className="button button-secondary" onClick={() => void restoreAppointment(item.appointmentId)} disabled={busy}>Restore</button></article>) : <p className="church-calendar-empty">No archived appointments.</p>}</section>}
    <div className="church-calendar-layout"><aside className="church-calendar-sidebar"><div className="church-calendar-mini-head"><strong>{monthLabel(anchor, language)}</strong><button className="icon-button" aria-label="Previous month" type="button" onClick={() => setAnchor((date) => shiftCalendarMonth(date, -1))}><ChevronLeft size={15} /></button><button className="icon-button" aria-label="Next month" type="button" onClick={() => setAnchor((date) => shiftCalendarMonth(date, 1))}><ChevronRight size={15} /></button></div><div className="church-calendar-mini-grid">{weekDays.map((day) => <span key={day}>{day[0]}</span>)}{Array.from({ length: 42 }, (_, index) => { const day = new Date(monthGridStart); day.setDate(day.getDate()+index); return <button key={index} className={`${day.getMonth() === anchor.getMonth() ? "" : "outside"} ${dateInput(day) === dateInput(anchor) ? "selected" : ""}`} type="button" onClick={() => setAnchor(day)}>{day.getDate()}</button>; })}</div><button type="button" className="church-calendar-today" onClick={() => setAnchor(todayInZone(viewerZone))}>Today</button>
      <label className="church-calendar-date-jump">Jump to date
        <input type="date" value={dateInput(anchor)} onChange={(event) => {
          const value = event.currentTarget.value;
          if (!event.currentTarget.validity.valid || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
          const target = new Date(`${value}T12:00:00`);
          if (Number.isFinite(target.getTime()) && dateInput(target) === value) setAnchor(target);
        }} />
      </label>
      <label className="church-calendar-display-zone">Display time zone
        <select value={viewerPreference} onChange={(event) => onStateChange(displayPreferencePrefix + event.target.value)}>
          <option value="appointments">Appointment time zones</option>
          <option value="location">Location ({locationTimeZone})</option>
          <option value="device">Device ({deviceTimeZone})</option>
          <optgroup label="Named time zones">{viewerTimeZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</optgroup>
        </select>
      </label>
      <label>Meeting request display<select value={meetingRequests} onChange={(event) => selectMeetingRequestScope(event.target.value as MeetingRequestScope)}>
        <option value="all">All appointments</option>
        <option value="mine">Only my meeting requests</option>
        <option value="invitations">My invitations</option>
      </select></label>
      {(tagOptions.size > 0 || canManageTags) && <details className="church-calendar-tag-filter">
        <summary>Appointment tags{selectedTags?.size ? ` (${selectedTags.size})` : ""}</summary>
        <fieldset>
          <legend>Match any selected tag</legend>
          <label>Search tags<input type="search" value={tagSearchText} onChange={(event) => setTagSearch({ departmentId, value: event.target.value })} /></label>
          <div className="church-calendar-tag-choices">
            {filteredTagOptions.map(([key, label]) => <label key={key}><input type="checkbox"
              checked={selectedTags?.has(key) ?? false} onChange={(event) => toggleTag(key, label, event.target.checked)} />
              {definitionsByKey.get(key)?.color && <span className="church-calendar-tag-color" aria-hidden="true" style={{ backgroundColor: definitionsByKey.get(key)?.color ?? "" }} />}
              <span title={definitionsByKey.get(key)?.description || undefined}>{label}</span>
            </label>)}
            {!filteredTagOptions.length && <span>No matching tags</span>}
          </div>
          {canManageTags && <button type="button" className="church-calendar-feed-button" onClick={() => setTagManagerDepartment(departmentId)}>Manage tags</button>}
          {Boolean(selectedTags?.size) && <button type="button" className="church-calendar-feed-button" onClick={() => setTagFilter(undefined)}>Clear tags</button>}
        </fieldset>
      </details>}
      <h2>My calendars</h2><div className="church-calendar-list">{calendars.map((calendar) => <div className="church-calendar-list-row" key={calendar.id}><label><input type="checkbox" checked={selectedCalendarIds.includes(calendar.id)} onChange={(event) => setSelectedCalendarIds((current) => event.target.checked ? [...current, calendar.id] : current.filter((id) => id !== calendar.id))} /><i style={{ background: calendar.color }} /><span>{calendar.name}</span><small>{calendar.scope === "personal" ? "Personal" : calendar.scope === "group" ? calendar.groupName ?? "Group" : "Community"}</small></label>
        {calendar.canManage && selectionLocation.current === departmentId && <button type="button" className="icon-button"
          aria-label={`Edit calendar ${calendar.name}`} disabled={busy} onClick={() => {
            setCalendarEdit({ departmentId, id: calendar.id, name: calendar.name, color: calendar.color, sortOrder: String(calendar.sortOrder ?? 0),
              allowMemberAppointments: calendar.scope === "group" ? calendar.allowMemberAppointments === true : undefined,
              defaultServicePlanTemplateId: calendar.defaultServicePlanTemplateId, initialDefaultServicePlanTemplateId: calendar.defaultServicePlanTemplateId });
            setError(""); setNotice("");
          }}><Pencil size={14} /></button>}</div>)}</div>{canManageShared && calendars.filter((calendar) => calendar.scope === "community").length > 0 && <section className="church-calendar-public-feed-settings"><h2>Public calendar feeds</h2>{calendars.filter((calendar) => calendar.scope === "community").map((calendar) => <div key={calendar.id}><span>{calendar.name}</span>{calendar.hasPublicFeed ? <><small>Feed enabled</small><button type="button" className="church-calendar-feed-button" onClick={() => void issuePublicFeed(calendar)} disabled={busy}>Rotate link</button><button type="button" className="church-calendar-feed-button" onClick={() => void revokePublicFeed(calendar)} disabled={busy}>Revoke</button></> : <button type="button" className="church-calendar-feed-button" onClick={() => void issuePublicFeed(calendar)} disabled={busy}>Create feed link</button>}</div>)}</section>}{calendars.some((calendar) => calendar.canSubscribe || calendar.hasSubscription) && <section className="church-calendar-public-feed-settings">
        <h2>My calendar subscriptions</h2>
        {calendars.filter((calendar) => calendar.canSubscribe || calendar.hasSubscription).map((calendar) => <div key={calendar.id}>
          <span>{calendar.name}</span>
          {calendar.canSubscribe && <button type="button" className="church-calendar-feed-button" disabled={busy} onClick={() => void changeSubscription(calendar, "POST")}>{calendar.hasSubscription ? "Replace link" : "Create link"}</button>}
          {calendar.hasSubscription && <button type="button" className="church-calendar-feed-button" disabled={busy} onClick={() => void changeSubscription(calendar, "DELETE")}>Revoke</button>}
        </div>)}
      </section>}
      <CalendarEmailUpdates key={JSON.stringify([accountId, departmentId])} departmentId={departmentId} csrfToken={csrfToken} />
      {canManageTags && <CalendarPublicAgendas key={`${accountId ?? ""}:${departmentId}`} departmentId={departmentId} csrfToken={csrfToken}
        calendars={selectionLocation.current === departmentId ? calendars.filter((calendar) => calendar.scope === "community" && calendar.hasPublicFeed) : []} />}
      {issuedFeed?.departmentId === departmentId && <section className="church-calendar-feed-result" aria-label="Calendar link">
        <strong>{issuedFeed.name}</strong>
        <label>Calendar link <input value={issuedFeed.url} readOnly onFocus={(event) => event.target.select()} /></label>
        {issuedFeed.confidential && <small>Keep this link private. Anyone with it can read this feed while your access is active.</small>}
        <div className="church-calendar-feed-actions">
          <a href={issuedFeed.url.replace(/^https?:/, "webcal:")} referrerPolicy="no-referrer">Subscribe in calendar app</a>
          <button type="button" className="church-calendar-feed-button" onClick={() => void copyFeed(issuedFeed.url)}>Copy link</button>
          <a href={issuedFeed.url} download="calendar.ics" referrerPolicy="no-referrer">Download .ics</a>
        </div>
        {!issuedFeed.confidential && issuedFeed.embedUrl && <CalendarEmbedCode key={issuedFeed.embedUrl} url={issuedFeed.embedUrl} />}
      </section>}{!calendars.length && !loading && <p className="church-calendar-empty">Create your first personal calendar or a shared calendar.</p>}</aside>
      <section className="church-calendar-main"><div className="church-calendar-toolbar"><div className="church-calendar-date-nav"><button type="button" className="icon-button" aria-label="Previous" onClick={() => move(-1)}><ChevronLeft size={18} /></button><button type="button" className="icon-button" aria-label="Next" onClick={() => move(1)}><ChevronRight size={18} /></button><h2>{view === "year" ? anchor.getFullYear() : monthLabel(anchor, language)}</h2><button type="button" className="church-calendar-today" onClick={() => setAnchor(todayInZone(viewerZone))}>Today</button></div><div className="church-calendar-views" role="group" aria-label="Calendar view">{(["day", "week", "month", "year", "list"] as View[]).map((item) => <button type="button" key={item} className={view === item ? "active" : ""} aria-pressed={view === item} onClick={() => setView(item)}>{item[0].toUpperCase()+item.slice(1)}</button>)}</div>{dayOrWeek && <label className="church-calendar-check"><input type="checkbox" checked={compact} onChange={(event) => setCompact(event.target.checked)} /> Compact layout</label>}<button type="button" className="button button-secondary" disabled={loading || loadedPrintScope !== printScope} onClick={printCalendar}><Printer size={15} /> Print calendar</button></div>
        {loading ? <div className="church-calendar-loading"><RotateCcw size={18} className="spinning" /> Loading appointments…</div> : view === "month" ? <div className="church-calendar-month"><div className="church-calendar-weekdays">{["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day) => <span key={day}>{day}</span>)}</div><div className="church-calendar-month-grid">{Array.from({ length: 42 }, (_, index) => { const day = new Date(monthGridStart); day.setDate(day.getDate()+index); return <div key={index} className={`church-calendar-day ${day.getMonth() !== anchor.getMonth() ? "outside" : ""}`}><button className="church-calendar-day-number" type="button" onClick={() => { setAnchor(day); setView("day"); }}>{day.getDate()}</button>{eventsForDay(day).slice(0,4).map(appointmentButton)}{eventsForDay(day).length > 4 && <small>+{eventsForDay(day).length-4} more</small>}</div>; })}</div></div> : showTimeGrid ? <CalendarTimeGrid
          days={Array.from({ length: view === "day" ? 1 : 7 }, (_, index) => {
            const day = dateFromLocal(range.from);
            day.setDate(day.getDate() + index);
            return { date: dateInput(day), label: dayLabel(day, language), add: () => openNew(day) };
          })}
          events={visibleAppointments.map((item) => ({
            id: item.appointmentId + ":" + (item.originalOccurrenceStartAt ?? item.occurrenceStartAt),
            startsAt: displayStart(item), endsAt: item.viewEndsAt ?? item.occurrenceEndAt, allDay: item.allDay,
            title: item.title, time: timeLabel(item), color: calendars.find((calendar) => calendar.id === item.calendarId)?.color,
            detail: [viewerPreference === "appointments" && !item.allDay && item.timeZone !== locationTimeZone ? item.timeZone : null,
              item.timeShifted ? "Adjusted for clock change" : null, item.myMeetingResponse && requestLabels[item.myMeetingResponse],
              item.place].filter(Boolean).join(" · "),
            open: () => openEdit(item),
          }))}
          formatHour={(hour) => clockFormatter.format(new Date(Date.UTC(2000, 0, 1, hour)))}
        /> : dayOrWeek ? <div className={`church-calendar-columns church-calendar-columns-${view}`}>{Array.from({ length: view === "day" ? 1 : 7 }, (_, index) => { const day = new Date(anchor); if (view === "week") day.setDate(day.getDate()-((day.getDay()+6)%7)+index); return <section key={index} className="church-calendar-column"><header><strong>{dayLabel(day, language)}</strong><button type="button" aria-label={`New appointment ${dateInput(day)}`} onClick={() => openNew(day)}><Plus size={14} /></button></header>{eventsForDay(day).map(appointmentButton)}{!eventsForDay(day).length && <button type="button" className="church-calendar-add-slot" onClick={() => openNew(day)}>Add appointment</button>}</section>; })}</div> : view === "year" ? <div className="church-calendar-year">{Array.from({ length: 12 }, (_, month) => { const first = new Date(anchor.getFullYear(), month, 1); const count = visibleAppointments.filter((event) => Number(displayStart(event).slice(5,7)) === month + 1).length; return <button type="button" key={month} onClick={() => { setAnchor(first); setView("month"); }}><strong>{new Intl.DateTimeFormat(locale, { month: "long" }).format(first)}</strong><span>{count} appointments</span></button>; })}</div> : <div className="church-calendar-list-view">{visibleAppointments.map((item) => <Fragment key={`${item.appointmentId}:${item.originalOccurrenceStartAt ?? item.occurrenceStartAt}`}><button type="button" onClick={() => openEdit(item)}><span className="church-calendar-list-date">{dayLabel(dateFromLocal(displayStart(item)), language)}</span><span className="church-calendar-list-title"><strong>{item.title}</strong>{item.myMeetingResponse && <small>Meeting request · {requestLabels[item.myMeetingResponse]}</small>}<small>{item.calendarName}{item.place ? ` · ${item.place}` : ""}{item.responsiblePersonName ? ` · On behalf of ${item.responsiblePersonName}` : ""}</small></span><span>{timeLabel(item)}</span><ChevronRight size={16} /></button>{(item.signupGroupName || item.linkedEventId || item.resourceBookings?.some((booking) => booking.scope === "occurrence")) && <div className="church-calendar-list-links">{appointmentLinks(item)}</div>}</Fragment>)}</div>}
        {!loading && !visibleAppointments.length && <div className="church-calendar-empty-state"><CalendarDays size={28} /><strong>No appointments in this view</strong><span>{selectedTags?.size ? "Choose another tag or date to show more appointments." : "Try another date or add an appointment."}</span><button type="button" className="button button-primary" onClick={() => openNew()}><Plus size={15} /> New appointment</button></div>}
      </section></div>
    {calendarEdit?.departmentId === departmentId && <div className="church-calendar-modal-backdrop" role="presentation">
      <section className="church-calendar-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-edit-heading">
        <header><h2 id="calendar-edit-heading">Edit calendar</h2><button type="button" className="icon-button" aria-label="Close" onClick={() => setCalendarEdit(null)}><X size={18} /></button></header>
        <form onSubmit={(event) => void saveCalendarDetails(event)}>
          <label>Calendar name<input required maxLength={120} value={calendarEdit.name} onChange={(event) => setCalendarEdit({ ...calendarEdit, name: event.target.value })} /></label>
          <label>Color<input type="color" value={calendarEdit.color} onChange={(event) => setCalendarEdit({ ...calendarEdit, color: event.target.value })} /></label>
          <label>Sort order<input type="number" required min={0} max={2_147_483_647} value={calendarEdit.sortOrder} onChange={(event) => setCalendarEdit({ ...calendarEdit, sortOrder: event.target.value })} /><small>Lower numbers appear first within the calendar type.</small></label>
          {calendarEdit.allowMemberAppointments !== undefined && <label className="church-calendar-check">
            <input type="checkbox" checked={calendarEdit.allowMemberAppointments} onChange={(event) => setCalendarEdit({ ...calendarEdit, allowMemberAppointments: event.target.checked })} /> Allow active group members to add appointments
          </label>}
          {calendarEdit.defaultServicePlanTemplateId !== undefined && <label>Default service-plan template
            <select value={calendarEdit.defaultServicePlanTemplateId ?? ""} onChange={(event) => setCalendarEdit({ ...calendarEdit, defaultServicePlanTemplateId: event.target.value || null })}>
              <option value="">No default</option>
              {calendarEdit.defaultServicePlanTemplateId && !choices.servicePlanTemplates.some(({ id }) => id === calendarEdit.defaultServicePlanTemplateId)
                && <option value={calendarEdit.defaultServicePlanTemplateId} disabled>Previously selected template is unavailable</option>}
              {choices.servicePlanTemplates.map(({ id, name }) => <option value={id} key={id}>{name}</option>)}
            </select>
            <small>Preselects a template when a manager opens event generation on a recurring appointment.</small>
          </label>}
          <footer><button type="button" className="button button-secondary" onClick={() => setCalendarEdit(null)}>Cancel</button>
            <button type="submit" className="button button-primary" disabled={busy || !calendarEdit.name.trim()}>Save changes</button></footer>
        </form>
      </section></div>}
    {canManageTags && tagManagerDepartment === departmentId && <CalendarTagManager key={departmentId}
      departmentId={departmentId} csrfToken={csrfToken} tags={activeTagDefinitions} visibleCounts={visibleTagCounts}
      onClose={() => setTagManagerDepartment(undefined)} onChange={() => setTagRevision((value) => value + 1)}
    />}
    {showCalendarForm && <div className="church-calendar-modal-backdrop" role="presentation"><section className="church-calendar-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-create-heading"><header><div><span className="eyebrow">CALENDAR SETUP</span><h2 id="calendar-create-heading">New calendar</h2></div><button className="icon-button" type="button" aria-label="Close" onClick={() => setShowCalendarForm(false)}><X size={18} /></button></header><form onSubmit={(event) => void createCalendar(event)}><label>Calendar name<input required maxLength={120} value={calendarName} onChange={(event) => setCalendarName(event.target.value)} /></label><label>Calendar type<select value={calendarScope} onChange={(event) => setCalendarScope(event.target.value as Scope)}><option value="personal">Personal</option>{canManageShared && <><option value="community">Community</option><option value="group">Group</option></>}</select></label>{calendarScope === "group" && <label>Group<select required value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">Choose group</option>{choices.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}<label>Color<input type="color" value={calendarColor} onChange={(event) => setCalendarColor(event.target.value)} /></label>
      <label>Sort order<input type="number" required min={0} max={2_147_483_647} value={calendarSortOrder} onChange={(event) => setCalendarSortOrder(event.target.value)} /><small>Lower numbers appear first within the calendar type.</small></label>
      {calendarScope === "group" && <label className="church-calendar-check"><input type="checkbox" checked={allowMemberAppointments}
        onChange={(event) => setAllowMemberAppointments(event.target.checked)} /> Allow active group members to add appointments</label>}<footer><button type="button" className="button button-secondary" onClick={() => setShowCalendarForm(false)}>Cancel</button><button type="submit" className="button button-primary" disabled={busy || !calendarName.trim()}><Plus size={15} /> Create calendar</button></footer></form></section></div>}
    {showForm && <div className="church-calendar-modal-backdrop" role="presentation"><section className="church-calendar-modal church-calendar-appointment-modal" role="dialog" aria-modal="true" aria-labelledby="appointment-heading"><header><div><span className="eyebrow">{editing ? "APPOINTMENT DETAILS" : "NEW APPOINTMENT"}</span><h2 id="appointment-heading">{editing ? "Edit appointment" : "Create appointment"}</h2></div><button className="icon-button" type="button" aria-label="Close" disabled={busy && confirmRemoval} onClick={() => setShowForm(false)}><X size={18} /></button></header><form onSubmit={(event) => void saveAppointment(event)}><div className="church-calendar-form-grid">
      {editing?.calendarScope === "group" && <CalendarMeetingRequests
        key={`${departmentId}:${editing.appointmentId}:${editing.originalOccurrenceStartAt ?? editing.occurrenceStartAt}`}
        departmentId={departmentId} csrfToken={csrfToken} appointmentId={editing.appointmentId}
        originalStart={editing.originalOccurrenceStartAt ?? editing.occurrenceStartAt} onChange={() => void load()}
      />}
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
      {showTimeGrid && editing && (editing.signupToken || editing.signupGroupName || editing.eventRegistration || editing.linkedEventId || editing.linkedEventCancelled) &&
        <div className="church-calendar-list-links wide">{appointmentLinks(editing, false)}</div>}
      {linkedResourceBookings.length > 0 && <div className="church-calendar-extra-date wide">
        <strong>Resource bookings</strong>
        <ul className="church-calendar-extra-date-list">{linkedResourceBookings.map((booking) => <li key={booking.id}>
          <div><strong>{booking.name}</strong><br /><small>{booking.scope === "occurrence" ? "This occurrence" : "Entire appointment"} · {booking.status === "approved" ? "Confirmed" : booking.status === "requested" ? "Pending approval" : booking.status} · Setup {booking.leadInMinutes} min · Cleanup {booking.cleanupMinutes} min</small>
            {booking.timeMismatch && <p role="status">The booking time differs from the appointment. Review it in Resources.</p>}</div>
          {canManageCalendarResources && editing && booking.scope === "occurrence" && (booking.status === "requested" || booking.status === "approved") &&
            <CalendarBookingDescription
              key={`${departmentId}:${editing.appointmentId}:${editing.originalOccurrenceStartAt ?? editing.occurrenceStartAt}:${booking.id}`}
              appointmentId={editing.appointmentId} originalStart={editing.originalOccurrenceStartAt ?? editing.occurrenceStartAt}
              bookingId={booking.id} departmentId={departmentId} csrfToken={csrfToken}
            />}
          {canManageCalendarResources && editing && booking.scope === "occurrence" && booking.canManageStatus
            && (booking.status === "requested" || booking.status === "approved") && <CalendarBookingDecision
            key={JSON.stringify([departmentId, accountId, editing.appointmentId, editing.originalOccurrenceStartAt ?? editing.occurrenceStartAt, booking.id])}
            appointmentId={editing.appointmentId} originalStart={editing.originalOccurrenceStartAt ?? editing.occurrenceStartAt}
            bookingId={booking.id} departmentId={departmentId} csrfToken={csrfToken} status={booking.status}
            timeMismatch={booking.timeMismatch} onChanged={(status) => {
              setEditing((current) => current?.appointmentId === editing.appointmentId
                ? { ...current, resourceBookings: current.resourceBookings?.map((item) => item.id === booking.id ? { ...item, status } : item) }
                : current);
              setNotice("Resource reservation " + status + ".");
              void load();
            }}
          />}
          {onNavigateEntity && <button className="button button-secondary" type="button" onClick={() => onNavigateEntity("booking", booking.id)}>Open booking</button>}
        </li>)}</ul>
      </div>}
      {canBookWithDraft && <CalendarDraftResources key={JSON.stringify([departmentId, accountId, draft.calendarId])}
        draftDate={draft.startsAt} recurring={draft.repeat} headers={headers} selections={newResourceBookings} onChange={setNewResourceBookings} disabled={busy} />}
      {canManageCalendarResources && editing?.resourceWindow && editing.resourceWindow.endsAt > editing.resourceWindow.startsAt && <CalendarResourceRequest
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
<label className="wide">Title<input required maxLength={160} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><label>Calendar<select required value={draft.calendarId} onChange={(event) => { setCreateEventTemplateId(""); setNewResourceBookings([]); setDraft({ ...draft, calendarId: event.target.value }); }}>{(editing ? writableCalendars.filter((calendar) => calendar.canManage) : writableCalendars).map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</select></label><label>Subtitle<input maxLength={240} value={draft.subtitle} onChange={(event) => setDraft({ ...draft, subtitle: event.target.value })} /></label>{!contributorDraft && choices.canSelectPeople && <div className="church-calendar-person-picker"><label>On behalf of · search People<input type="search" minLength={2} maxLength={80} value={personSearch} onChange={(event) => { setPersonSearch(event.target.value); setDraft({ ...draft, responsibleContactId: "" }); }} placeholder="Enter a name" /></label><label>Person<select value={draft.responsibleContactId} onChange={(event) => setDraft({ ...draft, responsibleContactId: event.target.value })}><option value="">No person selected</option>{personChoices.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><small>Only People records in this location are available. Contact details are not shared with other calendar viewers.</small></div>}{zoneField}<label>Starts<input type="datetime-local" required value={draft.startsAt} onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })} /></label><label>Ends<input type="datetime-local" required value={draft.endsAt} onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })} /></label><label>Place<input maxLength={200} value={draft.place} onChange={(event) => setDraft({ ...draft, place: event.target.value })} /></label><label>Web link<input type="url" maxLength={1000} value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="https://" /></label>{!contributorDraft && (!editing || editing.canManage) && <><label>Appointment image<input type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={(event) => { const file = event.target.files?.[0] ?? null; setImageMetadata(emptyAppointmentImageMetadata); if (file && file.size > 1048576) { setError("Choose an image smaller than 1 MiB."); setImageFile(null); } else { setError(""); setImageFile(file); } }} /><small>JPEG, PNG, GIF or WebP, up to 1 MiB.</small></label></>}{imageFile && <NewAppointmentImage key={imageFile.name} file={imageFile} metadata={imageMetadata} onChange={setImageMetadata} disabled={busy} />}
      {!imageFile && editing?.imageUrl && <SavedAppointmentImage
        key={JSON.stringify([departmentId, accountId, editing.appointmentId, editing.occurrenceStartAt])}
        imageUrl={editing.imageUrl} departmentId={departmentId} csrfToken={csrfToken} editable={editing.canManage}
        busy={busy} isRecurring={!!editing.recurrence} onRemove={() => void removeAppointmentImage()} />}
      <label className="wide">Description<textarea rows={4} maxLength={8000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label><label>Tags<input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="Separate with commas" /></label>{activeTagDefinitions.length > 0 && (!editing || editing.canManage) && <label>Add managed tag<select value="" onChange={(event) => {
        const key = event.target.value;
        if (key) setDraft((current) => {
          const keys = current.tags.split(",").map((tag) => tag.trim()).filter(Boolean);
          if (keys.length < 30 && !keys.some((tag) => tag.toLowerCase() === key)) keys.push(key);
          return { ...current, tags: keys.join(", ") };
        });
      }}><option value="">Choose a tag</option>{activeTagDefinitions.map((tag) => <option key={tag.key} value={tag.key}>{tag.name}</option>)}</select></label>}{!contributorDraft && <><label>Link service/event<select value={draft.linkedEventId} onChange={(event) => { setCreateEventTemplateId(""); setDraft({ ...draft, linkedEventId: event.target.value }); }}><option value="">No linked event</option>{choices.events.map((choice) => <option key={choice.id} value={choice.id}>{choice.event_date} · {choice.title}</option>)}</select></label>{canCreateEventWithAppointment && <label>Create linked service event from template
        <select value={createEventTemplateId} onChange={(event) => setCreateEventTemplateId(event.target.value)}>
          <option value="">Appointment only</option>
          {choices.servicePlanTemplates.map(({ id, name }) => <option key={id} value={id}>
            {name}{id === draftCalendar?.defaultServicePlanTemplateId ? " (Calendar default)" : ""}
          </option>)}
        </select>
        <small>The appointment title, time, place and description will appear in Services &amp; events.</small>
      </label>}<label>Group signup<select value={draft.signupGroupId} onChange={(event) => setDraft({ ...draft, signupGroupId: event.target.value })}><option value="">No signup link</option>{choices.signupGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><small>Existing public group signup page.</small></label>{(!editing?.recurrence || scope !== "occurrence") && <label>Link approved resource bookings to the appointment<select multiple value={draft.resourceBookingIds} onChange={(event) => setDraft({ ...draft, resourceBookingIds: Array.from(event.currentTarget.selectedOptions, (option) => option.value) })}>{choices.resourceBookings.map((booking) => <option key={booking.id} value={booking.id}>{booking.starts_at.slice(0,16).replace("T", " ")} · {booking.purpose}</option>)}</select><small>Hold Ctrl or Command to select multiple bookings.</small></label>}</>}<label className="church-calendar-check"><input type="checkbox" checked={draft.allDay} onChange={(event) => setDraft({ ...draft, allDay: event.target.checked })} /> All day</label><label className="church-calendar-check"><input type="checkbox" checked={draft.internalOnly} onChange={(event) => { setCreateEventTemplateId(""); setDraft({ ...draft, internalOnly: event.target.checked }); }} /> Internal appointment</label><label className="church-calendar-check wide"><input type="checkbox" checked={draft.repeat} onChange={(event) => { setCreateEventTemplateId(""); setDraft({ ...draft, repeat: event.target.checked }); }} /><Repeat2 size={15} /> Repeat appointment</label>{draft.repeat && <div className="church-calendar-recurrence wide"><label>Repeat pattern<select value={draft.frequency} onChange={(event) => setDraft({ ...draft, frequency: event.target.value as Frequency })}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly by date</option><option value="monthly_weekday">Monthly by weekday</option><option value="yearly">Yearly</option><option value="manual">Manual dates</option></select></label><label>Every<input type="number" min={1} max={365} value={draft.interval} onChange={(event) => setDraft({ ...draft, interval: Number(event.target.value) })} /></label>{draft.frequency === "weekly" && <fieldset><legend>Days of week</legend>{weekDays.map((day, index) => <label key={day}><input type="checkbox" checked={draft.weekdays.includes(index)} onChange={(event) => setDraft({ ...draft, weekdays: event.target.checked ? [...draft.weekdays, index] : draft.weekdays.filter((value) => value !== index) })} />{day}</label>)}</fieldset>}{draft.frequency === "monthly_weekday" && <><label>Week of month<select value={draft.weekOfMonth} onChange={(event) => setDraft({ ...draft, weekOfMonth: Number(event.target.value) })}><option value={1}>First</option><option value={2}>Second</option><option value={3}>Third</option><option value={4}>Fourth</option><option value={-1}>Last</option></select></label><label>Weekday<select value={draft.weekday} onChange={(event) => setDraft({ ...draft, weekday: Number(event.target.value) })}>{weekDays.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label></>}{draft.frequency === "manual" && <div className="church-calendar-manual-dates"><label className="wide">Manual dates<input type="text" placeholder="YYYY-MM-DD, YYYY-MM-DD" value={draft.manualDates} onChange={(event) => setDraft({ ...draft, manualDates: event.target.value })} /><small>Enter up to 100 dates separated by commas.</small></label></div>}<label>End date<input type="date" value={draft.endsOn} onChange={(event) => setDraft({ ...draft, endsOn: event.target.value })} /></label><label>Or after occurrences<input type="number" min={1} max={500} value={draft.count} onChange={(event) => setDraft({ ...draft, count: event.target.value })} /></label></div>}{editing?.canManage && <label className="church-calendar-check wide"><input type="checkbox" checked={notifyCreator} onChange={(event) => setNotifyCreator(event.target.checked)} /> Notify the appointment creator</label>}{editing?.recurrence && <label className="wide">Apply changes<select disabled={busy} value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="occurrence">This appointment only</option><option value="future">This and following</option><option value="series">Entire series</option></select></label>}{editing?.recurrence && canManageGroups && <div className="church-calendar-extra-date wide"><strong>Generate registration groups</strong>
      {!!choices.registrationFormTemplates?.length && <label>Signup form template
        <select value={registrationTemplateId} onChange={(event) => setRegistrationTemplateId(event.target.value)}>
          <option value="">Start with an empty form</option>
          {choices.registrationFormTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>
        <small>Copies questions, heading, default role and capacity. Each new group uses review before admission.</small>
      </label>}
      <div><label>Generate through<input type="date" min={editing.seriesStartsAt.slice(0,10)} max={(() => { const date = new Date(`${editing.seriesStartsAt.slice(0,10)}T00:00:00`); date.setFullYear(date.getFullYear() + 5); return dateInput(date); })()} value={registrationThrough} onChange={(event) => setRegistrationThrough(event.target.value)} /></label><button type="button" className="button button-secondary" onClick={() => void generateRegistrationGroups()} disabled={!registrationThrough || busy}><Plus size={14} /> Generate groups</button></div><small>Creates an unpublished group for each occurrence through this date. Signup starts disabled. Up to 500 occurrences are processed.</small></div>}{editing?.recurrence && canManageEvents && <div className="church-calendar-extra-date wide"><strong>Generate service events from a template</strong><div><label>Service-plan template<select value={eventTemplateId} onChange={(event) => selectEventTemplate(event.target.value)}><option value="">Choose a template…</option>{choices.servicePlanTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>{choices.canSelectPeople && (selectedServiceTemplate?.positions?.length ?? 0) > 0 && <div className="church-calendar-staff-picker"><label className="wide">Search People to assign<input type="search" minLength={2} maxLength={80} value={eventStaffSearch} onChange={(event) => setEventStaffSearch(event.target.value)} placeholder="Enter at least two letters" /></label><div className="church-calendar-staff-roles">{selectedServiceTemplate!.positions.map((position, index) => <label className="church-calendar-staff-role" key={`${index}-${position.name}`}><span>{position.name}{position.category ? ` · ${position.category}` : ""}{position.qualificationIds?.length ? " · Qualified volunteers only" : ""}</span><select value={eventStaffAssignments[index] ?? ""} onChange={(event) => assignEventStaff(index, event.target.value)}><option value="">Unassigned</option>{eventStaffOptions.filter((person) => person.id === eventStaffAssignments[index] || (position.qualificationIds ?? []).every((id) => person.qualificationIds?.includes(id.toLowerCase()))).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>)}</div><small className="wide">Selected volunteers are assigned to the matching template role in every generated event. Leave a role unassigned to keep it open.</small></div>}<label>Event kind<select value={eventKind} onChange={(event) => setEventKind(event.target.value as typeof eventKind)}><option value="service">Service</option><option value="meeting">Meeting</option><option value="community">Community</option><option value="other">Other</option></select></label><label className="church-calendar-check"><input type="checkbox" checked={eventRegistrationEnabled} onChange={(event) => setEventRegistrationEnabled(event.target.checked)} /> Enable public event registration</label>{eventRegistrationEnabled && <label>Capacity per event<input type="number" min={1} max={100000} step={1} value={eventRegistrationCapacity} onChange={(event) => setEventRegistrationCapacity(event.target.value)} placeholder="Unlimited" /><small>Public registration requires a community appointment. Find each generated registration link in Services &amp; events.</small></label>}<label>Generate through<input type="date" min={editing.seriesStartsAt.slice(0,10)} max={(() => { const date = new Date(`${editing.seriesStartsAt.slice(0,10)}T00:00:00`); date.setFullYear(date.getFullYear() + 5); return dateInput(date); })()} value={eventGenerationThrough} onChange={(event) => setEventGenerationThrough(event.target.value)} /></label><button type="button" className="button button-secondary" onClick={() => void generateServiceEvents()} disabled={!eventGenerationThrough || !eventTemplateId || busy}><Plus size={14} /> Preview and generate</button></div><small>Shows a preview before creating events. Existing links and cancelled occurrences are skipped. Up to 500 occurrences are processed.</small></div>}{editing?.recurrence && <div className="church-calendar-extra-date wide"><strong>Add an extra date to this series</strong><div><input aria-label="Extra date starts" type="datetime-local" value={extraStart} onChange={(event) => setExtraStart(event.target.value)} /><input aria-label="Extra date ends" type="datetime-local" value={extraEnd} onChange={(event) => setExtraEnd(event.target.value)} /><button type="button" className="button button-secondary" onClick={() => void addExtraDate()} disabled={!extraStart || !extraEnd || busy}><Plus size={14} /> Add date</button></div>{extraDates.length ? <ul className="church-calendar-extra-date-list">{extraDates.map((date) => <li key={date.startsAt}><span>{date.startsAt.replace("T", " ").slice(0,16)} – {date.endsAt.slice(11,16)}</span><button type="button" className="button button-secondary" onClick={() => void removeExtraDate(date)} disabled={busy}>Remove</button></li>)}</ul> : <small>No extra dates have been added.</small>}</div>}</div>{confirmRemoval && editing?.canManage && <CalendarRemoval
      key={JSON.stringify([departmentId,accountId,editing.appointmentId,scope,editing.originalOccurrenceStartAt ?? editing.occurrenceStartAt])}
      appointmentId={editing.appointmentId} scope={scope} original={editing.originalOccurrenceStartAt ?? editing.occurrenceStartAt}
      departmentId={departmentId} csrfToken={csrfToken} busy={busy} onBusy={setBusy} onBack={() => setConfirmRemoval(false)}
      onRemoved={(released) => {
        setShowForm(false); setConfirmRemoval(false);
        setNotice(released ? "Appointment removed. " + released + " resource reservations released." : "Appointment removed.");
        void load();
      }}
    />}<footer>{editing?.canManage && !confirmRemoval && <button type="button" className="button button-danger" onClick={() => setConfirmRemoval(true)} disabled={busy}><Trash2 size={15} /> Remove</button>}<span /><button type="button" className="button button-secondary" disabled={busy && confirmRemoval} onClick={() => setShowForm(false)}>Cancel</button><button type="submit" className="button button-primary" disabled={busy || !draft.title.trim() || !draft.calendarId}><Plus size={15} /> {busy ? "Saving…" : editing ? "Save changes" : "Create appointment"}</button></footer></form></section></div>}
  </main>;
}
