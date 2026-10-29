import { lazy } from "react";
import { MessagesSquare } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";
import { translationsForModule } from "../translations";

export const moduleRegistration: ModuleRegistration = {
  id: "chat",
  name: "Chat",
  translations: translationsForModule("chat"),
  icon: MessagesSquare,
  enabledByDefault: true,
  component: lazy(() => import("./ChatModule").then(({ ChatModule }) => ({ default: ChatModule }))),
};
