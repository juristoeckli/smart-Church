import { lazy } from "react";
import { Laptop } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";

export const moduleRegistration: ModuleRegistration = {
  id: "system-laptop",
  name: "System Laptop",
  icon: Laptop,
  adminOnly: false,
  component: lazy(() => import("./SystemLaptopModule").then(({ SystemLaptopModule }) => ({ default: SystemLaptopModule }))),
};
