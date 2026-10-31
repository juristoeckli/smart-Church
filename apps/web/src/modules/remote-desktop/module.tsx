import { lazy } from "react";
import { Laptop } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";
import { translationsForModule } from "../translations";
import { mergeModuleTranslationOverrides } from "../ui-translation-overrides";
import { RemoteDesktopSettings } from "./RemoteDesktopSettings";

export const moduleRegistration: ModuleRegistration = {
  id: "remote-desktop",
  name: "Remote desktop",
  translations: mergeModuleTranslationOverrides("remote-desktop", translationsForModule("remote-desktop")),
  icon: Laptop,
  adminOnly: false,
  component: lazy(() => import("./SystemLaptopModule").then(({ SystemLaptopModule }) => ({ default: SystemLaptopModule }))),
  settings: RemoteDesktopSettings,
};
