import { lazy } from "react";
import { Puzzle } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";
import { moduleDemoTranslations } from "./translations";

export const moduleRegistration: ModuleRegistration = {
  id: "module-demo",
  name: "Module Demo",
  translations: moduleDemoTranslations,
  icon: Puzzle,
  enabledByDefault: false,
  pageClassName: "page-wrap-module-demo",
  component: lazy(() => import("./ModuleDemo").then(({ ModuleDemo }) => ({ default: ModuleDemo }))),
};
