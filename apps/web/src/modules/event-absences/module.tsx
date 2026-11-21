import { lazy } from "react";
import { CalendarOff } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";

export const moduleRegistration: ModuleRegistration = {
  id: "event-absences",
  name: "Volunteer absences",
  icon: CalendarOff,
  enabledByDefault: true,
  pageClassName: "page-wrap-event-absences",
  component: lazy(() => import("./EventAbsencesModule").then(({ EventAbsencesModule }) => ({ default: EventAbsencesModule }))),
};
