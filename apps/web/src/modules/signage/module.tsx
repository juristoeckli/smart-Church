import { lazy } from "react";
import { PanelsTopLeft } from "lucide-react";
import type { ModuleContext, ModuleRegistration } from "../../module-registry";
import {translateModuleText} from "../../module-registry";
import {signageTranslations} from "./translations";

const SignagePage = lazy(() => import("./workspace").then(({ SignageWorkspace }) => ({ default: SignageWorkspace })));
function SignageModule(context: ModuleContext) {
  const grants = context.department.modulePermissions?.signage ?? [];
  const canAdmin = context.canManageSite || grants.includes("admin") || grants.includes("manage");
  const canManage = canAdmin || grants.includes("operator");
  return <SignagePage key={context.departmentId} departmentId={context.departmentId} csrfToken={context.csrfToken} canManage={canManage} canAdmin={canAdmin} state={context.state} onStateChange={context.onStateChange} language={context.language} />;
}

const sections = ["Overview", "Shows", "Media", "Schedule", "Displays"];
function SignageNavigation({ context }: { context: ModuleContext }) {
  return <div className="nav-submenu" aria-label="Signage pages">{sections.map(section => <button type="button" key={section} className={`nav-item nav-sub-item ${context.state.split("/")[0] === section ? "nav-item-active" : ""}`} onClick={() => context.onStateChange(section)}>{translateModuleText(section,signageTranslations,context.language)}</button>)}</div>;
}

export const moduleRegistration: ModuleRegistration = {
  id: "signage",
  name: "Public signage",
  translations: signageTranslations,
  icon: PanelsTopLeft,
  initialState: "Overview",
  navigation: SignageNavigation,
  navigationItems: context => sections.map(section => ({ id: section, label: translateModuleText(section,signageTranslations,context.language), state: section })),
  accessLabel: "Public signage",
  accessLevels: [
    { value: "operator", label: "Signage Operator", description: "Create and publish shows, manage media and schedules, and view display status." },
    { value: "admin", label: "Signage Admin", description: "All operator rights, plus create, configure, pair, and remove displays." },
    { value: "display", label: "Operate the display assigned to this service account" },
  ],
  isAvailable: ({ department, canManageSite }) => (department.enabledModules ?? []).includes("signage") && (canManageSite || (department.modulePermissions?.signage ?? []).some(grant => ["operator", "admin", "manage"].includes(grant))),
  component: SignageModule,
};
