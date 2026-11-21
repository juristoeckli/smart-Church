import { CalendarDays } from "lucide-react";
import type { ModuleRegistration, ModuleSettingsContext } from "../../module-registry";
import { translationsForModule } from "../translations";
import { CalendarSyncSettings } from "./CalendarSyncSettings";
import "./calendar-sync.css";

function Settings({ departmentId, csrfToken }: ModuleSettingsContext) {
  return <CalendarSyncSettings departmentId={departmentId} csrfToken={csrfToken} />;
}

function CalendarSyncModule() { return null; }

export const moduleRegistration: ModuleRegistration = {
  id: "calendar-sync",
  name: "Calendar Sync",
  translations: translationsForModule("sync", "Calendar Sync"),
  icon: CalendarDays,
  adminOnly: false,
  enabledByDefault: true,
  hiddenFromNavigation: true,
  component: CalendarSyncModule,
  settings: Settings,
};
