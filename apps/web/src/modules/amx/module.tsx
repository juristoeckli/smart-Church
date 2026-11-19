import { lazy } from "react";
import { AudioLines } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";

export const moduleRegistration: ModuleRegistration = {
  id: "amx",
  name: "AMX",
  icon: AudioLines,
  adminOnly: true,
  enabledByDefault: false,
  component: lazy(() => import("./workspace").then(({ AmxWorkspace }) => ({ default: AmxWorkspace }))),
  settings: lazy(() => import("./settings").then(({ AmxSettings }) => ({ default: AmxSettings }))),
};
