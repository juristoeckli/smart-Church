import { lazy } from "react";
import { MessagesSquare } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";

export const moduleRegistration: ModuleRegistration = {
  id: "chat",
  name: "Chat",
  icon: MessagesSquare,
  enabledByDefault: true,
  component: lazy(() => import("./ChatModule").then(({ ChatModule }) => ({ default: ChatModule }))),
};
