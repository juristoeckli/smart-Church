import { Component, lazy, Suspense, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { DepartmentProfile } from "@smart-church/contracts";

export interface ModuleContext {
  department: DepartmentProfile;
  departmentId: string;
  csrfToken: string;
  canManageSite: boolean;
  state: string;
  onStateChange: (state: string) => void;
}

export interface ModuleAccessContext {
  department: DepartmentProfile;
  canManageSite: boolean;
}

export interface ModuleRegistration {
  id: string;
  name: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  enabledByDefault?: boolean;
  initialState?: string;
  isAvailable?: (context: ModuleAccessContext) => boolean;
  component: ComponentType<ModuleContext>;
  navigation?: ComponentType<{ context: ModuleContext }>;
  pageClassName?: string;
}

const registrations = import.meta.glob<{ moduleRegistration: ModuleRegistration }>("./modules/*/module.tsx", { eager: true });

export const registeredModules = Object.values(registrations)
  .map(({ moduleRegistration }) => moduleRegistration)
  .filter((module) => /^[a-z0-9][a-z0-9-]*$/.test(module.id));

interface ModuleBoundaryProps { children: ReactNode; }
interface ModuleBoundaryState { failed: boolean; }

class ModuleBoundary extends Component<ModuleBoundaryProps, ModuleBoundaryState> {
  state: ModuleBoundaryState = { failed: false };

  static getDerivedStateFromError(): ModuleBoundaryState { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Optional module failed to load.", error, info.componentStack);
  }

  render() {
    if (this.state.failed) return <section className="module-load-error" role="alert"><h2>This module could not be opened</h2><p>The rest of Smart-Church is still available. Check this module's setup and try again.</p></section>;
    return this.props.children;
  }
}

export function ModuleHost({ module, context }: { module: ModuleRegistration; context: ModuleContext }) {
  const Module = module.component;
  return <ModuleBoundary key={module.id}><Suspense fallback={<section className="module-load-error" role="status">Loading {module.name}…</section>}><Module {...context} /></Suspense></ModuleBoundary>;
}
