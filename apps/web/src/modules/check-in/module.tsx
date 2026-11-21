import { lazy } from "react";
import { ClipboardCheck } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";

export const moduleRegistration: ModuleRegistration = {
  id: "check-in", name: "Check-in", icon: ClipboardCheck, enabledByDefault: true,
  pageClassName: "page-wrap-check-in",
  component: lazy(() => import("./CheckInModule").then(({ CheckInModule }) => ({ default: CheckInModule }))),
};
