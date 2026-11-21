import { lazy } from "react";
import { WalletCards } from "lucide-react";
import type { ModuleRegistration } from "../../module-registry";

export const moduleRegistration: ModuleRegistration = {
  id: "finance",
  name: "Finance & Giving",
  icon: WalletCards,
  enabledByDefault: false,
  accessLabel: "Finance",
  accessLevels: [
    { value: "view", label: "View finance", description: "View the ledger, donors, budgets, and reports." },
    { value: "manage", label: "Manage finance", description: "Maintain accounting data and post or reverse transactions." },
  ],
  isAvailable: ({ department, canManageSite }) => (department.enabledModules ?? []).includes("finance") && (canManageSite || department.role === "site_admin" || (department.modulePermissions?.finance ?? []).some((grant) => grant === "view" || grant === "manage")),
  pageClassName: "page-wrap-finance",
  component: lazy(() => import("./FinanceModule").then(({ FinanceModule }) => ({ default: FinanceModule }))),
};
