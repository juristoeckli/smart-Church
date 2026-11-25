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
    { value: "group-donors-view", label: "View group donors", description: "View donor names and types for authorized group cost centers." },
    { value: "group-finance-view", label: "View group finance", description: "Read budgets and journal lines for explicitly granted group cost centers." },
    { value: "simple-booking", label: "Simple group booking", description: "Use booking purposes for explicitly granted group roles and cost centers." },
    { value: "view", label: "View finance", description: "View the ledger, donors, budgets, and reports." },
    { value: "manage", label: "Manage finance", description: "Maintain accounting data and post or reverse transactions." },
  ],
  isAvailable: ({ department, canManageSite }) => (department.enabledModules ?? []).includes("finance") && (canManageSite || department.role === "site_admin" || (department.modulePermissions?.finance ?? []).some((grant) => grant === "view" || grant === "manage" || grant === "simple-booking" || grant === "group-finance-view" || grant === "group-donors-view")),
  pageClassName: "page-wrap-finance",
  component: lazy(() => import("./FinanceModule").then(({ FinanceModule }) => ({ default: FinanceModule }))),
};
