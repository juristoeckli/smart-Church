import { lazy } from "react";
import { ClipboardCheck } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";

export const moduleRegistration: ModuleRegistration = {
  id: "group-operations",
  name: "Group operations",
  icon: ClipboardCheck,
  enabledByDefault: true,
  pageClassName: "page-wrap-group-operations",
  component: lazy(() => import("./GroupOperationsModule").then(({ GroupOperationsModule }) => ({ default: GroupOperationsModule }))),
};
