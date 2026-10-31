import { RefreshCw } from "lucide-react";
import type { ModuleRegistration, ModuleSettingsContext } from "../../module-registry";
import { translationsForModule } from "../translations";
import { SyncModule } from "./ChurchToolsSyncSettings";
import "../sync/federation.css";

function ChurchToolsSettings({ departmentId, csrfToken }: ModuleSettingsContext) {
  return <ChurchToolsModule departmentId={departmentId} csrfToken={csrfToken} settingsPanel />;
}

export const moduleRegistration: ModuleRegistration = {
  id: "churchtools-sync",
  name: "ChurchTools Sync",
  translations: translationsForModule("sync", "ChurchTools Sync"),
  icon: RefreshCw,
  adminOnly: true,
  enabledByDefault: false,
  hiddenFromNavigation: true,
  component: ChurchToolsModule,
  settings: ChurchToolsSettings,
};

function ChurchToolsModule(props: { departmentId: string; csrfToken: string; settingsPanel?: boolean }) {
  return <SyncModule {...props} />;
}
