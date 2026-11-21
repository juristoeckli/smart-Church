import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Building2, CalendarDays, ContactRound, Settings2, UsersRound, X } from "lucide-react";
import type { BookableResource, ChurchGroup, Contact, ServiceEvent } from "@smart-church/contracts";
import { formatUserDate } from "./date-format";
import { HomeDutyRequests } from "./HomeDutyRequests";
import { HomeWelcome } from "./HomeWelcome";
import { HomeRecordedEventFacts } from "./HomeRecordedEventFacts";
import { getActiveLanguage, translate, type TranslationKey } from "./i18n";
import { translateModuleUiOverrideMessage } from "./modules/ui-translation-overrides";

type OverviewPage = "People" | "Services & events" | "Groups" | "Resources";
type UpcomingBirthday = { person: string; nextDate: string };
type UpcomingAnniversary = { person: string; nextDate: string; years?: number | null };
type GroupAppointment = { appointmentId: string; occurrenceStartAt: string; occurrenceEndAt: string; title: string; calendarName: string; place: string | null; allDay: boolean; internalOnly: boolean; calendarScope: string };
type ResourceBooking = { id: string; resourceName: string; location: string; purpose: string; requesterName: string; startsAt: string; endsAt: string };
type HomeBookings = { current: ResourceBooking[]; pending: ResourceBooking[] | null };
type RecentEventFact = { eventDate: string; title: string; adults: number; children: number; checkedIn: number; firstTimeVisitors: number };
const dashboardWidgetIds = ["stats", "events", "birthdays", "anniversaries", "groupAppointments", "currentBookings", "resourceApprovals", "recentEventFacts", "dutyRequests"] as const;
type DashboardWidgetId = typeof dashboardWidgetIds[number];
const defaultDashboardWidgets = { order: [...dashboardWidgetIds], visible: [...dashboardWidgetIds] };
type WidgetLayout = typeof defaultDashboardWidgets;
type DashboardSettings = WidgetLayout & { source: "personal" | "location"; locationDefault: WidgetLayout };

function readWidgetLayout(value: unknown): WidgetLayout {
  if (!value || typeof value !== "object") return defaultDashboardWidgets;
  const layout = value as { order?: unknown; visible?: unknown };
  const known = (entry: unknown): entry is DashboardWidgetId => typeof entry === "string" && dashboardWidgetIds.includes(entry as DashboardWidgetId);
  const order = Array.isArray(layout.order) ? layout.order.filter(known) : [];
  const visible = Array.isArray(layout.visible) ? layout.visible.filter(known) : [];
  return { order: [...new Set([...order, ...dashboardWidgetIds])], visible: [...new Set(visible)] };
}

function readDashboardSettings(value: unknown): DashboardSettings {
  const data = value as { source?: string; locationDefault?: unknown } | undefined;
  return { ...readWidgetLayout(value), source: data?.source === "personal" ? "personal" : "location", locationDefault: readWidgetLayout(data?.locationDefault) };
}
const dashboardWidgetLabels: Record<DashboardWidgetId, TranslationKey> = {
  stats: "overview.widgetStats", events: "overview.widgetEvents", birthdays: "overview.widgetBirthdays",
  anniversaries: "overview.widgetAnniversaries", groupAppointments: "overview.widgetGroupAppointments",
  currentBookings: "overview.widgetCurrentBookings", resourceApprovals: "overview.resourceApprovals", recentEventFacts: "overview.widgetRecentEventFacts",
  dutyRequests: "overview.dutyRequests",
};

function attendanceSummary(rows: RecentEventFact[]) {
  const totals = rows.reduce((total, row) => ({ adults: total.adults + row.adults, children: total.children + row.children, checkedIn: total.checkedIn + row.checkedIn, visitors: total.visitors + row.firstTimeVisitors }), { adults: 0, children: 0, checkedIn: 0, visitors: 0 });
  return translate("overview.attendanceSummary").replace("{adults}", String(totals.adults)).replace("{children}", String(totals.children)).replace("{checkedIn}", String(totals.checkedIn)).replace("{visitors}", String(totals.visitors));
}

function previousYearDate(date: Date) {
  const previous = new Date(date);
  const month = previous.getUTCMonth();
  previous.setUTCFullYear(previous.getUTCFullYear() - 1);
  if (previous.getUTCMonth() !== month) previous.setUTCDate(0);
  return previous.toISOString().slice(0, 10);
}

async function loadHomeBookings(departmentId: string, signal?: AbortSignal) {
  const response = await fetch("/api/modules/resource-scheduler/home-bookings", { headers: { "x-department-id": departmentId }, signal });
  return response.ok ? await response.json() as HomeBookings : null;
}

export function Overview({ departmentId, departmentLocation, timeZone, contacts, csrfToken, canManageSite, onNavigate, onOpenBooking, onOpenGroupCalendar, onOpenEvent }: {
  departmentId: string;
  departmentLocation: string;
  timeZone: string;
  contacts: Contact[];
  csrfToken: string;
  canManageSite: boolean;
  onNavigate: (page: OverviewPage) => void;
  onOpenBooking: (id: string) => void;
  onOpenGroupCalendar: () => void;
  onOpenEvent: (id: string) => void;
}) {
  const [events, setEvents] = useState<ServiceEvent[]>([]);
  const [groups, setGroups] = useState<ChurchGroup[]>([]);
  const [resources, setResources] = useState<BookableResource[]>([]);
  const [birthdays, setBirthdays] = useState<UpcomingBirthday[] | null>(null);
  const [anniversaries, setAnniversaries] = useState<UpcomingAnniversary[] | null>(null);
  const [groupAppointments, setGroupAppointments] = useState<GroupAppointment[] | null>(null);
  const [bookings, setBookings] = useState<HomeBookings | null>(null);
  const [decidingBooking, setDecidingBooking] = useState(false);
  const [approvalFeedback, setApprovalFeedback] = useState("");
  const [recentEventFacts, setRecentEventFacts] = useState<RecentEventFact[] | null>(null);
  const [priorEventFacts, setPriorEventFacts] = useState<RecentEventFact[] | null>(null);
  const [detailsEvent, setDetailsEvent] = useState<ServiceEvent | null>(null);
  const [dashboardWidgets, setDashboardWidgets] = useState<DashboardSettings>({
    ...defaultDashboardWidgets, source: "location", locationDefault: defaultDashboardWidgets,
  });
  const [dashboardDraft, setDashboardDraft] = useState(defaultDashboardWidgets);
  const [dashboardScope, setDashboardScope] = useState<"personal" | "location">("personal");
  const [dashboardSettingsOpen, setDashboardSettingsOpen] = useState(false);
  const [dashboardLoaded, setDashboardLoaded] = useState(false);
  const [dashboardSaving, setDashboardSaving] = useState(false);
  const [dashboardFeedback, setDashboardFeedback] = useState("");
  const [error, setError] = useState("");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  const bookingTime = new Intl.DateTimeFormat(getActiveLanguage(), { timeZone, hour: "2-digit", minute: "2-digit" });
  const bookingDateTime = new Intl.DateTimeFormat(getActiveLanguage(), { timeZone, dateStyle: "short", timeStyle: "short" });

  useEffect(() => {
    const controller = new AbortController();
    const headers = { "x-department-id": departmentId };
    const localClock = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    const now = `${today}T${localClock.format(new Date())}`;
    const from = `${today}T00:00`;
    const throughDate = new Date(`${today}T12:00:00Z`);
    throughDate.setUTCDate(throughDate.getUTCDate() + 30);
    const through = throughDate.toISOString().slice(0, 10);
    // The calendar API enforces community/group membership visibility and
    // excludes personal calendars unless the current user owns them.
    void fetch(`/api/modules/church-calendar/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(`${through}T23:59`)}`, { headers, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const result = await response.json() as GroupAppointment[];
        if (!controller.signal.aborted && Array.isArray(result)) setGroupAppointments(result.filter((item) => item.calendarScope === "group" && (item.allDay || item.occurrenceEndAt > now)).slice(0, 6));
      }).catch(() => undefined);
    // Reports enforces both Reports access and private People access. Keep this
    // widget hidden when either grant is missing (or the optional module is off).
    void fetch("/api/modules/reports/run?reportKey=upcoming-birthdays", { headers, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const result = await response.json() as { rows?: UpcomingBirthday[] };
        if (Array.isArray(result.rows) && !controller.signal.aborted) setBirthdays(result.rows);
      }).catch(() => undefined);
    void fetch("/api/modules/reports/run?reportKey=upcoming-anniversaries", { headers, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const result = await response.json() as { rows?: UpcomingAnniversary[] };
        if (Array.isArray(result.rows) && !controller.signal.aborted) setAnniversaries(result.rows);
      }).catch(() => undefined);
    // Resource Scheduling is optional. The endpoint applies location scoping
    // and requester/manager visibility before the dashboard renders bookings.
    void loadHomeBookings(departmentId, controller.signal).then((result) => {
      if (!controller.signal.aborted) setBookings(result);
    }).catch(() => undefined);
    const factsFrom = new Date(`${today}T12:00:00Z`);
    factsFrom.setUTCDate(factsFrom.getUTCDate() - 29);
    async function loadFacts(from: string, to: string) {
      const response = await fetch(`/api/modules/reports/run?${new URLSearchParams({ reportKey: "event-attendance", from, to })}`, { headers, signal: controller.signal });
      if (!response.ok) return null;
      const result = await response.json() as { rows?: RecentEventFact[] };
      return Array.isArray(result.rows) ? result.rows : null;
    }
    void loadFacts(factsFrom.toISOString().slice(0, 10), today)
      .then(async (facts) => {
        if (controller.signal.aborted) return;
        setRecentEventFacts(facts);
        setPriorEventFacts(null);
        if (!facts) return;
        const prior = await loadFacts(previousYearDate(factsFrom), previousYearDate(new Date(`${today}T12:00:00Z`)));
        if (!controller.signal.aborted) setPriorEventFacts(prior);
      }).catch(() => undefined);
    Promise.all([
      fetch("/api/events", { headers, signal: controller.signal }),
      fetch("/api/groups", { headers, signal: controller.signal }),
      fetch("/api/resources", { headers, signal: controller.signal }),
    ]).then(async ([eventResponse, groupResponse, resourceResponse]) => {
      const [eventData, groupData, resourceData] = await Promise.all([eventResponse.json(), groupResponse.json(), resourceResponse.json()]);
      const failed = [eventResponse, groupResponse, resourceResponse].find((response) => !response.ok);
      if (failed) throw new Error("Some overview information could not be loaded.");
      setEvents(eventData as ServiceEvent[]);
      setGroups(groupData as ChurchGroup[]);
      setResources(resourceData as BookableResource[]);
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load overview."); });
    return () => controller.abort();
  }, [departmentId, timeZone, today]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/modules/notifications/home-widgets", { headers: { "x-department-id": departmentId }, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const result = readDashboardSettings(await response.json());
        if (!controller.signal.aborted) {
          setDashboardWidgets(result);
          setDashboardDraft(result);
        }
      }).catch(() => undefined).finally(() => { if (!controller.signal.aborted) setDashboardLoaded(true); });
    return () => controller.abort();
  }, [departmentId]);

  const upcoming = useMemo(() => events.filter((event) => event.eventDate >= today).slice(0, 4), [events, today]);
  const memberCount = contacts.filter((person) => person.status === "member").length;
  const stats = [
    { label: translate("overview.people"), value: contacts.length, detail: translate("overview.membersVisitors").replace("{members}", String(memberCount)).replace("{visitors}", String(contacts.length - memberCount)), icon: UsersRound, page: "People" as const },
    { label: translate("overview.upcomingEvents"), value: events.filter((event) => event.eventDate >= today).length, detail: translate("overview.churchCalendar"), icon: CalendarDays, page: "Services & events" as const },
    { label: translate("overview.groups"), value: groups.length, detail: translate("overview.groupMemberships").replace("{count}", String(groups.reduce((count, group) => count + group.memberCount, 0))), icon: ContactRound, page: "Groups" as const },
    { label: translate("overview.resources"), value: resources.filter((resource) => resource.active).length, detail: translate("overview.sharedResources"), icon: Building2, page: "Resources" as const },
  ];

  function chooseDashboardScope(scope: "personal" | "location") {
    setDashboardScope(scope);
    setDashboardDraft(scope === "location" ? dashboardWidgets.locationDefault : dashboardWidgets);
  }

  async function saveDashboardWidgets(reset = false) {
    if (dashboardScope === "location" && !canManageSite) return;
    setDashboardSaving(true);
    setDashboardFeedback("");
    try {
      const response = await fetch(`/api/modules/notifications/home-widgets${dashboardScope === "location" ? "/defaults" : ""}`, {
        method: reset ? "DELETE" : "PUT",
        headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken, ...(!reset ? { "content-type": "application/json" } : {}) },
        body: reset ? undefined : JSON.stringify({ order: dashboardDraft.order, visible: dashboardDraft.visible }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not save dashboard preferences.");
      setDashboardWidgets(readDashboardSettings(result));
      setDashboardSettingsOpen(false);
      setDashboardFeedback(translate("overview.dashboardSaved"));
    } catch (reason) {
      setDashboardFeedback(reason instanceof Error ? reason.message : "Could not save dashboard preferences.");
    } finally { setDashboardSaving(false); }
  }

  async function decideBooking(id: string, status: "approved" | "declined") {
    if (decidingBooking) return;
    setDecidingBooking(true);
    setApprovalFeedback("");
    try {
      const response = await fetch(`/api/modules/resource-scheduler/bookings/${id}/status`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify({ status, expectedStatus: "requested" }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(result.error ?? translate("overview.bookingDecisionFailed"));
      }
      setBookings((current) => current?.pending ? { ...current, pending: current.pending.filter((booking) => booking.id !== id) } : current);
      setApprovalFeedback(translate(status === "approved" ? "overview.bookingApproved" : "overview.bookingDeclined"));
    } catch (reason) {
      setApprovalFeedback(reason instanceof Error ? reason.message : translate("overview.bookingDecisionFailed"));
    } finally {
      try { setBookings(await loadHomeBookings(departmentId)); } catch { /* Keep the last loaded view if refresh fails. */ }
      setDecidingBooking(false);
    }
  }

  const recordedFacts = recentEventFacts?.filter((event) => event.checkedIn > 0 || event.adults > 0 || event.children > 0).slice(0, 5);
  const widgetContent: Record<DashboardWidgetId, ReactNode> = {
    dutyRequests: <HomeDutyRequests departmentId={departmentId} csrfToken={csrfToken} onOpenEvent={onOpenEvent} onOpenSchedule={() => onNavigate("Services & events")} />,
    stats: <section className="stat-grid community-overview-stats" aria-label={translate("overview.sectionLabel")}>
      {stats.map(({ label, value, detail, icon: Icon, page }) => <button className="stat-card community-stat-card" type="button" key={label} onClick={() => onNavigate(page)}><div className="stat-icon stat-icon-green"><Icon size={19} /></div><div className="stat-content"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div><ArrowRight className="community-stat-arrow" size={15} /></button>)}
    </section>,
    events: <section className="directory-card community-upcoming-card"><div className="directory-heading"><div><h2>{translate("overview.comingUp")}</h2><p>{translate("overview.nextAt").replace("{location}", departmentLocation)}</p></div><button className="button button-secondary" type="button" onClick={() => onNavigate("Services & events")}>{translate("overview.openCalendar")} <ArrowRight size={14} /></button></div>
      {upcoming.length ? <div className="community-upcoming-list">{upcoming.map((event) => <button className="community-upcoming-item community-upcoming-button" type="button" key={event.id} onClick={() => setDetailsEvent(event)}><span className="community-upcoming-date">{formatUserDate(event.eventDate)}</span><div><strong>{event.title}</strong><small>{event.startTime}{event.endTime ? `–${event.endTime}` : ""} · {event.location}</small></div><span className="event-kind">{event.kind === "service" ? translate("overview.service") : event.kind}</span></button>)}</div> : <p className="community-empty">{translate("overview.noUpcoming")}</p>}
    </section>,
    birthdays: birthdays !== null && <section className="directory-card community-upcoming-card"><div className="directory-heading"><div><h2>{translate("overview.birthdays")}</h2><p>{translate("overview.birthdaysHelp")}</p></div><button className="button button-secondary" type="button" onClick={() => onNavigate("People")}>{translate("overview.openPeople")} <ArrowRight size={14} /></button></div>{birthdays.length ? <div className="community-upcoming-list">{birthdays.slice(0, 6).map((birthday, index) => <div className="community-upcoming-item" key={`${birthday.person}:${birthday.nextDate}:${index}`}><span className="community-upcoming-date">{formatUserDate(birthday.nextDate)}</span><strong>{birthday.person}</strong></div>)}</div> : <p className="community-empty">{translate("overview.noBirthdays")}</p>}</section>,
    anniversaries: anniversaries !== null && <section className="directory-card community-upcoming-card"><div className="directory-heading"><div><h2>{translate("overview.anniversaries")}</h2><p>{translate("overview.anniversariesHelp")}</p></div><button className="button button-secondary" type="button" onClick={() => onNavigate("People")}>{translate("overview.openPeople")} <ArrowRight size={14} /></button></div>{anniversaries.length ? <div className="community-upcoming-list">{anniversaries.slice(0, 6).map((anniversary, index) => <div className="community-upcoming-item" key={`${anniversary.person}:${anniversary.nextDate}:${index}`}><span className="community-upcoming-date">{formatUserDate(anniversary.nextDate)}</span><div><strong>{anniversary.person}</strong>{anniversary.years != null && <small>{translate("overview.yearsMarried").replace("{years}", String(anniversary.years))}</small>}</div></div>)}</div> : <p className="community-empty">{translate("overview.noAnniversaries")}</p>}</section>,
    groupAppointments: groupAppointments !== null && <section className="directory-card community-upcoming-card"><div className="directory-heading"><div><h2>{translate("overview.groupAppointments")}</h2><p>{translate("overview.groupAppointmentsHelp")}</p></div><button className="button button-secondary" type="button" onClick={onOpenGroupCalendar}>{translate("overview.openCalendar")} <ArrowRight size={14} /></button></div>{groupAppointments.length ? <div className="community-upcoming-list">{groupAppointments.map((appointment) => <div className="community-upcoming-item" key={`${appointment.appointmentId}:${appointment.occurrenceStartAt}`}><span className="community-upcoming-date">{formatUserDate(appointment.occurrenceStartAt.slice(0, 10))}</span><div><strong>{appointment.title}</strong><small>{appointment.calendarName}{appointment.place ? ` · ${appointment.place}` : ""}{appointment.allDay ? ` · ${translate("overview.allDay")}` : ` · ${appointment.occurrenceStartAt.slice(11, 16)}`}{appointment.internalOnly ? ` · ${translate("overview.internal")}` : ""}</small></div></div>)}</div> : <p className="community-empty">{translate("overview.noGroupAppointments")}</p>}</section>,
    currentBookings: bookings && <section className="directory-card community-upcoming-card">
      <div className="directory-heading"><div><h2>{translate("overview.currentBookings")}</h2><p>{translate("overview.currentBookingsHelp")}</p></div><button className="button button-secondary" type="button" onClick={() => onNavigate("Resources")}>{translate("overview.openResources")} <ArrowRight size={14} /></button></div>
      {bookings.current.length ? <div className="community-upcoming-list">{bookings.current.map((booking) => <button className="community-upcoming-item community-upcoming-button" type="button" key={booking.id} onClick={() => onOpenBooking(booking.id)}><span className="community-upcoming-date">{bookingTime.format(new Date(booking.startsAt))}–{bookingTime.format(new Date(booking.endsAt))}</span><div><strong>{booking.purpose}</strong><small>{booking.resourceName}{booking.location ? ` · ${booking.location}` : ""}</small></div></button>)}</div> : <p className="community-empty">{translate("overview.noCurrentBookings")}</p>}
    </section>,
    resourceApprovals: bookings?.pending && <section className="directory-card community-upcoming-card">
      <div className="directory-heading"><div><h2>{translate("overview.resourceApprovals")}</h2><p>{translate("overview.resourceApprovalsHelp")}</p></div></div>
      {bookings.pending.length ? <div className="community-upcoming-list">{bookings.pending.map((booking) => <div className="community-upcoming-item" key={booking.id}>
        <span className="community-upcoming-date">{bookingDateTime.formatRange(new Date(booking.startsAt), new Date(booking.endsAt))}</span>
        <div><strong>{booking.purpose}</strong><small>{[booking.resourceName, booking.location, booking.requesterName].filter(Boolean).join(" · ")}</small></div>
        <div><button className="button button-secondary" type="button" disabled={decidingBooking} onClick={() => void decideBooking(booking.id, "approved")}>{translate("overview.approveBooking")}</button>{" "}
          <button className="button button-secondary" type="button" disabled={decidingBooking} onClick={() => void decideBooking(booking.id, "declined")}>{translate("overview.declineBooking")}</button></div>
      </div>)}</div> : <p className="community-empty">{translate("overview.noResourceApprovals")}</p>}
      {approvalFeedback && <p className="community-empty" role="status">{approvalFeedback}</p>}
    </section>,
    recentEventFacts: <>{recentEventFacts && <section className="directory-card community-upcoming-card">
      <div className="directory-heading"><div><h2>{translate("overview.recentEventFacts")}</h2><p>{translate("overview.recentEventFactsHelp")}</p></div><button className="button button-secondary" type="button" onClick={() => onNavigate("Services & events")}>{translate("overview.openCalendar")} <ArrowRight size={14} /></button></div>
      {recordedFacts?.length ? <div className="community-upcoming-list">{recordedFacts.map((event, index) => <div className="community-upcoming-item" key={`${event.eventDate}:${event.title}:${index}`}><span className="community-upcoming-date">{formatUserDate(event.eventDate)}</span><div><strong>{event.title}</strong><small>{attendanceSummary([event])}</small></div></div>)}</div> : <p className="community-empty">{translate("overview.noRecentEventFacts")}</p>}
      {priorEventFacts && <dl className="community-upcoming-list">
        <div className="community-upcoming-item"><dt>{translate("overview.currentFactsPeriod")}</dt><dd>{attendanceSummary(recentEventFacts)}</dd></div>
        <div className="community-upcoming-item"><dt>{translate("overview.priorFactsPeriod")}</dt><dd>{attendanceSummary(priorEventFacts)}</dd></div>
      </dl>}
    </section>}
      <HomeRecordedEventFacts key={departmentId + ":" + today.slice(0, 7)} departmentId={departmentId} period={today.slice(0, 7)} />
    </>,
  };

  return <>
    <div className={`demo-notice ${error ? "demo-notice-error" : ""}`}><span className="demo-dot" />{error ? translateModuleUiOverrideMessage("core-admin", getActiveLanguage(), error) : translate("overview.churchAt").replace("{location}", departmentLocation)}</div>
    <HomeWelcome departmentId={departmentId} csrfToken={csrfToken} canEdit={canManageSite}
      actions={<button className="button button-secondary" type="button" disabled={!dashboardLoaded} onClick={() => { chooseDashboardScope("personal"); setDashboardSettingsOpen(true); }}><Settings2 size={15} />{translate("overview.customizeHome")}</button>} />
    {dashboardLoaded && dashboardWidgets.order.map((id) => dashboardWidgets.visible.includes(id) ? <div key={id}>{widgetContent[id]}</div> : null)}
    {dashboardFeedback && <p role="status" className="community-empty">{dashboardFeedback}</p>}
    {dashboardSettingsOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDashboardSettingsOpen(false)}><section className="modal event-details-modal" role="dialog" aria-modal="true" aria-labelledby="overview-dashboard-settings-title"><div className="modal-heading"><div><span className="eyebrow">{translate("overview.eyebrow")}</span><h2 id="overview-dashboard-settings-title">{translate("overview.customizeHome")}</h2></div><button className="icon-button" type="button" aria-label={translate("events.closeDialog")} onClick={() => setDashboardSettingsOpen(false)}><X size={19} /></button></div>{canManageSite && <div className="dashboard-layout-scope" role="group" aria-label={translate("overview.customizeHome")}>
      <button className="button button-secondary" type="button" disabled={dashboardSaving} aria-pressed={dashboardScope === "personal"} onClick={() => chooseDashboardScope("personal")}>{translate("overview.personalLayout")}</button>
      <button className="button button-secondary" type="button" disabled={dashboardSaving} aria-pressed={dashboardScope === "location"} onClick={() => chooseDashboardScope("location")}>{translate("overview.locationLayout")}</button>
      </div>}
      <p>{translate(dashboardScope === "location" ? "overview.locationLayoutHelp" : "overview.customizeHomeHelp")}</p>
      {dashboardScope === "personal" && <p>{translate(dashboardWidgets.source === "personal" ? "overview.usingPersonalLayout" : "overview.usingLocationLayout")}</p>}
      <div className="dashboard-widget-settings">{dashboardDraft.order.map((id, index) => <div className="dashboard-widget-setting" key={id}><label><input type="checkbox" checked={dashboardDraft.visible.includes(id)} disabled={dashboardSaving} onChange={(event) => setDashboardDraft((current) => ({ ...current, visible: event.target.checked ? [...current.visible, id] : current.visible.filter((visibleId) => visibleId !== id) }))} /><span>{translate(dashboardWidgetLabels[id])}</span></label><span><button className="icon-button" type="button" aria-label={translate("overview.moveWidgetUp")} disabled={dashboardSaving || index === 0} onClick={() => setDashboardDraft((current) => { const order = [...current.order]; [order[index - 1], order[index]] = [order[index], order[index - 1]]; return { ...current, order }; })}><ArrowUp size={16} /></button><button className="icon-button" type="button" aria-label={translate("overview.moveWidgetDown")} disabled={dashboardSaving || index === dashboardDraft.order.length - 1} onClick={() => setDashboardDraft((current) => { const order = [...current.order]; [order[index + 1], order[index]] = [order[index], order[index + 1]]; return { ...current, order }; })}><ArrowDown size={16} /></button></span></div>)}</div><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setDashboardSettingsOpen(false)}>{translate("events.cancel")}</button>{(dashboardScope === "location" || dashboardWidgets.source === "personal") && <button className="button button-secondary" type="button" disabled={dashboardSaving} onClick={() => void saveDashboardWidgets(true)}>{translate(dashboardScope === "location" ? "overview.restoreBuiltInLayout" : "overview.restoreLocationLayout")}</button>}
      <button className="button button-primary" type="button" disabled={dashboardSaving} onClick={() => void saveDashboardWidgets()}>{dashboardSaving ? translate("events.saving") : translate("events.saveChanges")}</button></div></section></div>}
    {detailsEvent && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDetailsEvent(null)}><section className="modal event-details-modal" role="dialog" aria-modal="true" aria-labelledby="overview-event-details-title"><div className="modal-heading"><div><span className={`event-kind event-kind-${detailsEvent.kind}`}>{detailsEvent.kind === "service" ? translate("overview.service") : detailsEvent.kind}</span><h2 id="overview-event-details-title">{detailsEvent.title}</h2></div><button className="icon-button" type="button" aria-label={translate("events.closeDialog")} onClick={() => setDetailsEvent(null)}><X size={19} /></button></div><dl className="event-details-grid"><div><dt>{translate("events.date")}</dt><dd>{formatUserDate(detailsEvent.eventDate)}</dd></div><div><dt>{translate("events.time")}</dt><dd>{detailsEvent.isAllDay ? translate("events.allDay") : `${detailsEvent.startTime}${detailsEvent.endTime ? `–${detailsEvent.endTime}` : ""}`}</dd></div><div><dt>{translate("events.location")}</dt><dd>{detailsEvent.location}{detailsEvent.room ? ` · ${detailsEvent.room}` : ""}</dd></div></dl>{detailsEvent.description && <p className="event-details-description">{detailsEvent.description}</p>}<div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setDetailsEvent(null)}>{translate("events.close")}</button><button className="button button-primary" type="button" onClick={() => { setDetailsEvent(null); onNavigate("Services & events"); }}>{translate("overview.openCalendar")} <ArrowRight size={14} /></button></div></section></div>}
    <footer className="page-footer"><span>{translate("overview.footer")}</span><span>© 2026 Smart Church</span></footer>
  </>;
}
