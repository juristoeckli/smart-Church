import { lazy } from "react";
import { Laptop } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";
import { translationsForModule } from "../translations";
import { mergeModuleTranslationOverrides } from "../ui-translation-overrides";
import { RemoteDesktopSettings } from "./RemoteDesktopSettings";
import { RemoteDesktopNavigation } from "./navigation";

export const moduleRegistration: ModuleRegistration = {
  id: "remote-desktop",
  name: "Remote Desktop",
  translations: mergeModuleTranslationOverrides("remote-desktop", translationsForModule("remote-desktop")),
  icon: Laptop,
  adminOnly: false,
  component: lazy(() => import("./RemoteDesktopModule").then(({ RemoteDesktopModule }) => ({ default: RemoteDesktopModule }))),
  navigation: RemoteDesktopNavigation,
  settings: RemoteDesktopSettings,
};
