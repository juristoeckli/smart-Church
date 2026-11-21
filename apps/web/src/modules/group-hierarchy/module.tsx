import { lazy } from "react";
import { Network } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";

export const moduleRegistration: ModuleRegistration = {
  id: "group-hierarchy",
  name: "Group administration",
  icon: Network,
  enabledByDefault: true,
  pageClassName: "page-wrap-group-hierarchy",
  component: lazy(() => import("./GroupHierarchyModule").then(({ GroupHierarchyModule }) => ({ default: GroupHierarchyModule }))),
};
