import { RefreshCw } from "lucide-react";
import type { ModuleRegistration, ModuleSettingsContext } from "../../module-registry";
import { translationsForModule } from "../translations";
import { ElvantoSyncSettings } from "./ElvantoSyncSettings";
import "../sync/federation.css";

function ElvantoSettings({ departmentId }: ModuleSettingsContext) {
  return <ElvantoSyncSettings departmentId={departmentId} />;
}

function ElvantoModule({ departmentId }: { departmentId: string }) {
  return <ElvantoSyncSettings departmentId={departmentId} />;
}

export const moduleRegistration: ModuleRegistration = {
  id: "elvanto-sync",
  name: "Elvanto Sync",
  translations: translationsForModule("sync"),
  icon: RefreshCw,
  adminOnly: true,
  enabledByDefault: false,
  hiddenFromNavigation: true,
  component: ElvantoModule,
  settings: ElvantoSettings,
};
