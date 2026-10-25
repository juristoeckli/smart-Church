import { lazy } from "react";
import { MonitorPlay } from "lucide-react";
import type { ModuleContext, ModuleRegistration } from "../../module-registry";
import { hasPresenterAccess, presenterCapabilities } from "./PresenterRightsFieldset";

const PresenterPage = lazy(() => import("./PresenterWorkspace").then(({ PresenterWorkspace }) => ({ default: PresenterWorkspace })));

function PresenterModule(context: ModuleContext) {
  return <PresenterPage departmentId={context.departmentId} csrfToken={context.csrfToken} capabilities={presenterCapabilities(context.canManageSite, context.department.presenterPermissions ?? [])} />;
}

export const moduleRegistration: ModuleRegistration = {
  id: "presenter",
  name: "Presenter",
  icon: MonitorPlay,
  pageClassName: "page-wrap-presenter",
  isAvailable: ({ department, canManageSite }) => hasPresenterAccess((department.enabledModules ?? []).includes("presenter"), canManageSite, department.presenterPermissions ?? []),
  component: PresenterModule,
};
