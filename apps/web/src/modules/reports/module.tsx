import { lazy } from "react";
import { ChartNoAxesCombined } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";

export const moduleRegistration: ModuleRegistration = {
  id: "reports",
  name: "Reports",
  icon: ChartNoAxesCombined,
  enabledByDefault: true,
  accessLabel: "Reports",
  accessLevels: [
    { value: "view", label: "View reports", description: "Run permitted reports and export their rows." },
    { value: "manage", label: "Manage reports", description: "Save report definitions and remove definitions you own." },
  ],
  component: lazy(() => import("./ReportsModule").then(({ ReportsModule }) => ({ default: ReportsModule }))),
};
