import { lazy } from "react";
import { CalendarRange } from "lucide-react";
import type { ModuleContext, ModuleRegistration } from "../../module-registry";
import "./resource-scheduler.css";

const Page = lazy(() => import("./ResourceSchedulerModule").then(({ ResourceSchedulerModule }) => ({ default: ResourceSchedulerModule })));

function ResourceSchedulerModule(context: ModuleContext) {
  const canManage = context.canManageSite || (context.department.permissions ?? []).includes("resources_manage") || (context.department.modulePermissions?.["resource-scheduler"] ?? []).includes("manage");
  return <Page departmentId={context.departmentId} csrfToken={context.csrfToken} canManage={canManage} />;
}

export const moduleRegistration: ModuleRegistration = {
  id: "resource-scheduler",
  name: "Resource Scheduler",
  icon: CalendarRange,
  enabledByDefault: true,
  accessLabel: "Resource Scheduler",
  accessLevels: [{ value: "manage", label: "Manage resource scheduling", description: "Set availability, approve requests, and manage recurring bookings." }],
  component: ResourceSchedulerModule,
};
