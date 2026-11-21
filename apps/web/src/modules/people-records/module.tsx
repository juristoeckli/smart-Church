import { lazy } from "react";
import { ContactRound } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";

export const moduleRegistration: ModuleRegistration = {
  id: "people-records", name: "People Records", icon: ContactRound, enabledByDefault: true,
  accessLabel: "People Records",
  accessLevels: [
    { value: "view", label: "View records", description: "Browse private directory details, consents, and record history." },
    { value: "manage", label: "Manage records", description: "Edit custom fields, relationships, consent entries, and import previews." },
  ],
  isAvailable: ({ department, canManageSite }) => (department.enabledModules ?? []).includes("people-records") && (canManageSite || department.role === "site_admin" || (department.permissions ?? []).some((p) => p === "people_view_private" || p === "people_manage")),
  component: lazy(() => import("./PeopleRecordsModule").then(({ PeopleRecordsModule }) => ({ default: PeopleRecordsModule }))),
};
