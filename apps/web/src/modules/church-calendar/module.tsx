import { lazy } from "react";
import { CalendarDays } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";

export const moduleRegistration: ModuleRegistration = {
  id: "church-calendar",
  name: "Calendar",
  icon: CalendarDays,
  enabledByDefault: true,
  accessLabel: "Calendar",
  accessLevels: [{ value: "manage", label: "Manage shared calendars", description: "Create and update community and group calendar appointments." }],
  pageClassName: "page-wrap-church-calendar",
  component: lazy(() => import("./ChurchCalendarModule").then(({ ChurchCalendarModule }) => ({ default: ChurchCalendarModule }))),
};
