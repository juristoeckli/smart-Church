import { lazy } from "react";
import { Puzzle } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";

export const moduleRegistration: ModuleRegistration = {
  id: "module-demo",
  name: "Module Demo",
  icon: Puzzle,
  enabledByDefault: false,
  pageClassName: "page-wrap-module-demo",
  component: lazy(() => import("./ModuleDemo").then(({ ModuleDemo }) => ({ default: ModuleDemo }))),
};
