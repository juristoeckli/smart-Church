import { lazy } from "react";
import { BellRing } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";
import { translationsForModule } from "../translations";

export const moduleRegistration: ModuleRegistration = {
  id: "notifications",
  name: "Notifications",
  translations: translationsForModule("notifications"),
  icon: BellRing,
  required: true,
  enabledByDefault: true,
  component: lazy(() => import("./NotificationsModule").then(({ NotificationsModule }) => ({ default: NotificationsModule }))),
};
