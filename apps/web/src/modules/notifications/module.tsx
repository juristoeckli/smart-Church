import { lazy } from "react";
import { BellRing } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";

export const moduleRegistration: ModuleRegistration = {
  id: "notifications",
  name: "Notifications",
  icon: BellRing,
  enabledByDefault: true,
  component: lazy(() => import("./NotificationsModule").then(({ NotificationsModule }) => ({ default: NotificationsModule }))),
};
