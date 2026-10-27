import { lazy } from "react";
import { RefreshCw } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";

export const moduleRegistration: ModuleRegistration = {
  id: "sync",
  name: "Sync",
  icon: RefreshCw,
  adminOnly: true,
  enabledByDefault: true,
  component: lazy(() => import("./SyncModule").then(({ SyncModule }) => ({ default: SyncModule }))),
};
