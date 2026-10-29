import { lazy } from "react";
import { Laptop } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";
import { RemoteDesktopSettings } from "./RemoteDesktopSettings";

export const moduleRegistration: ModuleRegistration = {
  id: "remote-desktop",
  name: "Remote desktop",
  icon: Laptop,
  adminOnly: false,
  component: lazy(() => import("./SystemLaptopModule").then(({ SystemLaptopModule }) => ({ default: SystemLaptopModule }))),
  settings: RemoteDesktopSettings,
};
