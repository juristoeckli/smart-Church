import { lazy } from "react";
import { RefreshCw } from "lucide-react";
import type { ModuleRegistration, ModuleSettingsContext } from "../../module-registry";
import { translationsForModule } from "../translations";
import { SyncModule } from "./SyncModule";

function SyncSettings({ departmentId, csrfToken }: ModuleSettingsContext) {
  return <SyncModule departmentId={departmentId} csrfToken={csrfToken} settingsPanel />;
}

export const moduleRegistration: ModuleRegistration = {
  id: "sync",
  name: "Sync",
  translations: translationsForModule("sync"),
  icon: RefreshCw,
  adminOnly: true,
  enabledByDefault: true,
  hiddenFromNavigation: true,
  component: lazy(() => import("./SyncModule").then(({ SyncModule }) => ({ default: SyncModule }))),
  settings: SyncSettings,
};
