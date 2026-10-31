import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Building2, CalendarDays, ContactRound, UsersRound } from "lucide-react";
import type { BookableResource, ChurchGroup, Contact, ServiceEvent } from "@smart-church/contracts";
import { formatUserDate } from "./date-format";
import { getActiveLanguage, translate } from "./i18n";
import { translateModuleUiOverrideMessage } from "./modules/ui-translation-overrides";

type OverviewPage = "People" | "Services & events" | "Groups" | "Resources";

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
  const [error, setError] = useState("");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());

  useEffect(() => {
    const controller = new AbortController();
    const headers = { "x-department-id": departmentId };
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
  }, [departmentId]);

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
      {upcoming.length ? <div className="community-upcoming-list">{upcoming.map((event) => <article className="community-upcoming-item" key={event.id}><span className="community-upcoming-date">{formatUserDate(event.eventDate)}</span><div><strong>{event.title}</strong><small>{event.startTime}{event.endTime ? `–${event.endTime}` : ""} · {event.location}</small></div><span className="event-kind">{event.kind === "service" ? translate("overview.service") : event.kind}</span></article>)}</div> : <p className="community-empty">{translate("overview.noUpcoming")}</p>}
    </section>
    <footer className="page-footer"><span>{translate("overview.footer")}</span><span>© 2026 Smart Church</span></footer>
  </>;
}
