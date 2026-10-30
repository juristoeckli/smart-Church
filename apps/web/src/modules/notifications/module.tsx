import { lazy } from "react";
import { BellRing } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";
import { translationsForModule } from "../translations";
import { mergeModuleTranslationOverrides } from "../ui-translation-overrides";

export const moduleRegistration: ModuleRegistration = {
  id: "notifications",
  name: "Notifications",
  translations: mergeModuleTranslationOverrides("notifications", translationsForModule("notifications")),
  icon: BellRing,
  required: true,
  enabledByDefault: true,
  component: lazy(() => import("./NotificationsModule").then(({ NotificationsModule }) => ({ default: NotificationsModule }))),
};
