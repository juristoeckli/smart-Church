import { lazy } from "react";
import { MonitorPlay } from "lucide-react";
import type { ModuleContext, ModuleRegistration } from "../../module-registry";
import { translationsForModule } from "../translations";
import type { PresenterPermission } from "@smart-church/contracts";
import { hasPresenterAccess, presenterCapabilities } from "./PresenterRightsFieldset";

const PresenterPage = lazy(() => import("./PresenterWorkspace").then(({ PresenterWorkspace }) => ({ default: PresenterWorkspace })));

function PresenterModule(context: ModuleContext) {
  return <PresenterPage departmentId={context.departmentId} csrfToken={context.csrfToken} realtime={context.realtime} capabilities={presenterCapabilities(context.canManageSite, (context.department.modulePermissions?.presenter ?? context.department.presenterPermissions ?? []) as PresenterPermission[])} />;
}

export const moduleRegistration: ModuleRegistration = {
  id: "presenter",
  name: "Presenter",
  translations: translationsForModule("presenter"),
  icon: MonitorPlay,
  accessLabel: "Presenter",
  accessLevels: [
    { value: "editor", label: "Edit presentations" },
    { value: "operator", label: "Operate presentations" },
    { value: "admin", label: "Manage Presenter settings and datasets" },
  ],
  pageClassName: "page-wrap-presenter",
  isAvailable: ({ department, canManageSite }) => hasPresenterAccess((department.enabledModules ?? []).includes("presenter"), canManageSite, department.presenterPermissions ?? []),
  component: PresenterModule,
};
