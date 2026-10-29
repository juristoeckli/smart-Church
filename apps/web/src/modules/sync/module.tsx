import { lazy } from "react";
import { RefreshCw } from "lucide-react";
import type { ModuleRegistration, ModuleSettingsContext } from "../../module-registry";
import { SyncModule } from "./SyncModule";

function SyncSettings({ departmentId }: ModuleSettingsContext) {
  return <SyncModule departmentId={departmentId} settingsPanel />;
}

export const moduleRegistration: ModuleRegistration = {
  id: "sync",
  name: "Sync",
  icon: RefreshCw,
  adminOnly: true,
  enabledByDefault: true,
  hiddenFromNavigation: true,
  component: lazy(() => import("./SyncModule").then(({ SyncModule }) => ({ default: SyncModule }))),
  settings: SyncSettings,
};
