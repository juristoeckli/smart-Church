import { lazy } from "react";
import { MessagesSquare } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";
import { translationsForModule } from "../translations";
import { mergeModuleTranslationOverrides } from "../ui-translation-overrides";

export const moduleRegistration: ModuleRegistration = {
  id: "chat",
  name: "Chat",
  translations: mergeModuleTranslationOverrides("chat", translationsForModule("chat")),
  icon: MessagesSquare,
  enabledByDefault: true,
  component: lazy(() => import("./ChatModule").then(({ ChatModule }) => ({ default: ChatModule }))),
};
