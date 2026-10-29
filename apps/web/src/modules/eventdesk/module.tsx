import { lazy } from "react";
import { CalendarDays } from "lucide-react";
import type { ModuleContext, ModuleRegistration } from "../../module-registry";
import { translationsForModule } from "../translations";
import "./eventdesk.css";

const EventDeskPage = lazy(() => import("./EventDeskModule").then(({ EventDeskModule }) => ({ default: EventDeskModule })));
const sections = ["Overview", "Jobs", "Customers", "Suppliers & venues", "Equipment", "Warehouse", "Workshop", "Purchasing", "Freelancers", "Crew", "Documents"];

function EventDesk(context: ModuleContext) {
  return <EventDeskPage departmentId={context.departmentId} csrfToken={context.csrfToken} canManageSite={context.canManageSite} section={sections.includes(context.state) ? context.state : "Overview"} onSectionChange={context.onStateChange} />;
}

function EventDeskNavigation({ context }: { context: ModuleContext }) {
  const active = sections.includes(context.state) ? context.state : "Overview";
  return <div className="nav-submenu" aria-label="EventDesk sections">{sections.map((section) => <button className={`nav-item nav-sub-item ${active === section ? "nav-item-active" : ""}`} type="button" key={section} aria-current={active === section ? "page" : undefined} onClick={() => context.onStateChange(section)}><span>{section}</span>{active === section && <span className="nav-indicator" />}</button>)}</div>;
}

export const moduleRegistration: ModuleRegistration = {
  id: "eventdesk",
  name: "EventDesk",
  translations: translationsForModule("eventdesk"),
  icon: CalendarDays,
  enabledByDefault: false,
  initialState: "Overview",
  accessLabel: "EventDesk",
  accessLevels: [
    { value: "view", label: "View EventDesk", description: "View jobs, customers, equipment bookings, and crew requests." },
    { value: "jobs_manage", label: "Manage jobs", description: "Create jobs, link events, and update job status." },
    { value: "customers_manage", label: "Manage customers", description: "Create and update customer records used by jobs." },
    { value: "partners_manage", label: "Manage suppliers and venues", description: "Maintain supplier and venue directories for EventDesk." },
    { value: "inventory_manage", label: "Manage equipment", description: "Manage the equipment catalog and job bookings." },
    { value: "crew_manage", label: "Manage crew", description: "Manage freelancer profiles and availability, request and assign personnel, and track crew confirmations." },
    { value: "finance_manage", label: "Manage documents and payments", description: "Create quotes and invoices, track their status, and record payments." },
  ],
  isAvailable: ({ department, canManageSite }) => (department.enabledModules ?? []).includes("eventdesk") && (canManageSite || (department.modulePermissions?.eventdesk ?? []).length > 0),
  component: EventDesk,
  navigation: EventDeskNavigation,
  pageClassName: "page-wrap-eventdesk",
};
