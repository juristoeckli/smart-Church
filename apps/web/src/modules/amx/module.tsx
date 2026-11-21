import { lazy } from "react";
import { AudioLines } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";

export const moduleRegistration: ModuleRegistration = {
  id: "amx",
  name: "AMX",
  icon: AudioLines,
  enabledByDefault: false,
  accessLabel: "AMX room control",
  accessLevels: [{ value: "control", label: "Use AMX controls", description: "View and operate the AMX room controls at this location." }],
  isAvailable: ({ department, canManageSite }) => (department.enabledModules ?? []).includes("amx")
    && (canManageSite || department.role === "site_admin" || (department.modulePermissions?.amx ?? []).includes("control")),
  component: lazy(() => import("./workspace").then(({ AmxWorkspace }) => ({ default: AmxWorkspace }))),
  settings: lazy(() => import("./settings").then(({ AmxSettings }) => ({ default: AmxSettings }))),
};
