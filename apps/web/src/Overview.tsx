import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Building2, CalendarDays, ContactRound, UsersRound, X } from "lucide-react";
import type { BookableResource, ChurchGroup, Contact, ServiceEvent } from "@smart-church/contracts";
import { formatUserDate } from "./date-format";
import { getActiveLanguage, translate } from "./i18n";
import { translateModuleUiOverrideMessage } from "./modules/ui-translation-overrides";

type OverviewPage = "People" | "Services & events" | "Groups" | "Resources";
type UpcomingBirthday = { person: string; nextDate: string };
type GroupAppointment = { appointmentId: string; occurrenceStartAt: string; title: string; calendarName: string; place: string | null; allDay: boolean; internalOnly: boolean; calendarScope: string };

export function Overview({ departmentId, departmentLocation, timeZone, contacts, onNavigate }: {
  departmentId: string;
  departmentLocation: string;
  timeZone: string;
  contacts: Contact[];
  onNavigate: (page: OverviewPage) => void;
}) {
  const [events, setEvents] = useState<ServiceEvent[]>([]);
  const [groups, setGroups] = useState<ChurchGroup[]>([]);
  const [resources, setResources] = useState<BookableResource[]>([]);
  const [birthdays, setBirthdays] = useState<UpcomingBirthday[] | null>(null);
  const [groupAppointments, setGroupAppointments] = useState<GroupAppointment[] | null>(null);
  const [detailsEvent, setDetailsEvent] = useState<ServiceEvent | null>(null);
  const [error, setError] = useState("");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());

  useEffect(() => {
    const controller = new AbortController();
    const headers = { "x-department-id": departmentId };
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
        if (!controller.signal.aborted && Array.isArray(result)) setGroupAppointments(result.filter((item) => item.calendarScope === "group").slice(0, 6));
      }).catch(() => undefined);
    // Reports enforces both Reports access and private People access. Keep this
    // widget hidden when either grant is missing (or the optional module is off).
    void fetch("/api/modules/reports/run?reportKey=upcoming-birthdays", { headers, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const result = await response.json() as { rows?: UpcomingBirthday[] };
        if (Array.isArray(result.rows) && !controller.signal.aborted) setBirthdays(result.rows);
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
  }, [departmentId, today]);

  const upcoming = useMemo(() => events.filter((event) => event.eventDate >= today).slice(0, 4), [events, today]);
  const memberCount = contacts.filter((person) => person.status === "member").length;
  const stats = [
    { label: translate("overview.people"), value: contacts.length, detail: translate("overview.membersVisitors").replace("{members}", String(memberCount)).replace("{visitors}", String(contacts.length - memberCount)), icon: UsersRound, page: "People" as const },
    { label: translate("overview.upcomingEvents"), value: events.filter((event) => event.eventDate >= today).length, detail: translate("overview.churchCalendar"), icon: CalendarDays, page: "Services & events" as const },
    { label: translate("overview.groups"), value: groups.length, detail: translate("overview.groupMemberships").replace("{count}", String(groups.reduce((count, group) => count + group.memberCount, 0))), icon: ContactRound, page: "Groups" as const },
    { label: translate("overview.resources"), value: resources.filter((resource) => resource.active).length, detail: translate("overview.sharedResources"), icon: Building2, page: "Resources" as const },
  ];

  return <>
    <div className={`demo-notice ${error ? "demo-notice-error" : ""}`}><span className="demo-dot" />{error ? translateModuleUiOverrideMessage("core-admin", getActiveLanguage(), error) : translate("overview.churchAt").replace("{location}", departmentLocation)}</div>
    <section className="page-heading"><div><div className="eyebrow">{translate("overview.eyebrow")}</div><h1>{translate("overview.title")}</h1><p className="page-subtitle">{translate("overview.subtitle")}</p></div></section>
    <section className="stat-grid community-overview-stats" aria-label={translate("overview.sectionLabel")}>
      {stats.map(({ label, value, detail, icon: Icon, page }) => <button className="stat-card community-stat-card" type="button" key={label} onClick={() => onNavigate(page)}><div className="stat-icon stat-icon-green"><Icon size={19} /></div><div className="stat-content"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div><ArrowRight className="community-stat-arrow" size={15} /></button>)}
    </section>
    <section className="directory-card community-upcoming-card"><div className="directory-heading"><div><h2>{translate("overview.comingUp")}</h2><p>{translate("overview.nextAt").replace("{location}", departmentLocation)}</p></div><button className="button button-secondary" type="button" onClick={() => onNavigate("Services & events")}>{translate("overview.openCalendar")} <ArrowRight size={14} /></button></div>
      {upcoming.length ? <div className="community-upcoming-list">{upcoming.map((event) => <button className="community-upcoming-item community-upcoming-button" type="button" key={event.id} onClick={() => setDetailsEvent(event)}><span className="community-upcoming-date">{formatUserDate(event.eventDate)}</span><div><strong>{event.title}</strong><small>{event.startTime}{event.endTime ? `–${event.endTime}` : ""} · {event.location}</small></div><span className="event-kind">{event.kind === "service" ? translate("overview.service") : event.kind}</span></button>)}</div> : <p className="community-empty">{translate("overview.noUpcoming")}</p>}
    </section>
    {birthdays !== null && <section className="directory-card community-upcoming-card"><div className="directory-heading"><div><h2>{translate("overview.birthdays")}</h2><p>{translate("overview.birthdaysHelp")}</p></div><button className="button button-secondary" type="button" onClick={() => onNavigate("People")}>{translate("overview.openPeople")} <ArrowRight size={14} /></button></div>{birthdays.length ? <div className="community-upcoming-list">{birthdays.slice(0, 6).map((birthday, index) => <div className="community-upcoming-item" key={`${birthday.person}:${birthday.nextDate}:${index}`}><span className="community-upcoming-date">{formatUserDate(birthday.nextDate)}</span><strong>{birthday.person}</strong></div>)}</div> : <p className="community-empty">{translate("overview.noBirthdays")}</p>}</section>}
    {groupAppointments !== null && <section className="directory-card community-upcoming-card"><div className="directory-heading"><div><h2>{translate("overview.groupAppointments")}</h2><p>{translate("overview.groupAppointmentsHelp")}</p></div></div>{groupAppointments.length ? <div className="community-upcoming-list">{groupAppointments.map((appointment) => <div className="community-upcoming-item" key={`${appointment.appointmentId}:${appointment.occurrenceStartAt}`}><span className="community-upcoming-date">{formatUserDate(appointment.occurrenceStartAt.slice(0, 10))}</span><div><strong>{appointment.title}</strong><small>{appointment.calendarName}{appointment.place ? ` · ${appointment.place}` : ""}{appointment.allDay ? ` · ${translate("overview.allDay")}` : ` · ${appointment.occurrenceStartAt.slice(11, 16)}`}{appointment.internalOnly ? ` · ${translate("overview.internal")}` : ""}</small></div></div>)}</div> : <p className="community-empty">{translate("overview.noGroupAppointments")}</p>}</section>}
    {detailsEvent && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDetailsEvent(null)}><section className="modal event-details-modal" role="dialog" aria-modal="true" aria-labelledby="overview-event-details-title"><div className="modal-heading"><div><span className={`event-kind event-kind-${detailsEvent.kind}`}>{detailsEvent.kind === "service" ? translate("overview.service") : detailsEvent.kind}</span><h2 id="overview-event-details-title">{detailsEvent.title}</h2></div><button className="icon-button" type="button" aria-label={translate("events.closeDialog")} onClick={() => setDetailsEvent(null)}><X size={19} /></button></div><dl className="event-details-grid"><div><dt>{translate("events.date")}</dt><dd>{formatUserDate(detailsEvent.eventDate)}</dd></div><div><dt>{translate("events.time")}</dt><dd>{detailsEvent.isAllDay ? translate("events.allDay") : `${detailsEvent.startTime}${detailsEvent.endTime ? `–${detailsEvent.endTime}` : ""}`}</dd></div><div><dt>{translate("events.location")}</dt><dd>{detailsEvent.location}{detailsEvent.room ? ` · ${detailsEvent.room}` : ""}</dd></div></dl>{detailsEvent.description && <p className="event-details-description">{detailsEvent.description}</p>}<div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setDetailsEvent(null)}>{translate("events.close")}</button><button className="button button-primary" type="button" onClick={() => { setDetailsEvent(null); onNavigate("Services & events"); }}>{translate("overview.openCalendar")} <ArrowRight size={14} /></button></div></section></div>}
    <footer className="page-footer"><span>{translate("overview.footer")}</span><span>© 2026 Smart Church</span></footer>
  </>;
}
