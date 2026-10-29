import { Component, lazy, Suspense, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { DepartmentProfile } from "@smart-church/contracts";
import type { RealtimeEvent } from "./realtime";

export interface ModuleRealtime {
  subscribe: (topic: string, listener: (event: RealtimeEvent) => void) => () => void;
  isConnected: () => boolean;
  send: (topic: string, payload?: unknown) => boolean;
}

export interface ModuleContext {
  department: DepartmentProfile;
  departmentId: string;
  csrfToken: string;
  realtime?: ModuleRealtime;
  systemNotificationsEnabled?: boolean;
  canManageSite: boolean;
  state: string;
  onStateChange: (state: string) => void;
  requestedChatConversationId?: string | null;
  onChatConversationOpened?: (conversationId: string) => void;
  onActiveChatChange?: (conversationId: string | null) => void;
  refreshCsrfToken?: () => Promise<string>;
}

export interface ModuleSettingsContext {
  departmentId: string;
  csrfToken: string;
  departments: DepartmentProfile[];
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
  accessLabel?: string;
  accessLevels?: Array<{ value: string; label: string; description?: string }>;
  isAvailable?: (context: ModuleAccessContext) => boolean;
  component: ComponentType<ModuleContext>;
  settings?: ComponentType<ModuleSettingsContext>;
  navigation?: ComponentType<{ context: ModuleContext }>;
  pageClassName?: string;
}

const registrations = import.meta.glob<{ moduleRegistration: ModuleRegistration }>("./modules/*/module.tsx");

export const registeredModules: ModuleRegistration[] = [];
export const moduleRegistryReady = Promise.all(Object.entries(registrations).map(async ([path, load]) => {
  try {
    const { moduleRegistration } = await load();
    const iconType = typeof moduleRegistration?.icon;
    const componentType = typeof moduleRegistration?.component;
    if (!moduleRegistration || !/^[a-z0-9][a-z0-9-]*$/.test(moduleRegistration.id) || !moduleRegistration.name || moduleRegistration.icon == null || (iconType !== "function" && iconType !== "object") || moduleRegistration.component == null || (componentType !== "function" && componentType !== "object")) {
      throw new Error("The module registration is missing a valid ID, name, icon, or component.");
    }
    return moduleRegistration;
  } catch (error) {
    console.error(`Optional module registration failed (${path}); the rest of Smart-Church will continue.`, error);
    return null;
  }
})).then((modules) => {
  registeredModules.push(...modules.filter((module): module is ModuleRegistration => module !== null));
});

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

class ModuleIconBoundary extends Component<ModuleBoundaryProps, ModuleBoundaryState> {
  state: ModuleBoundaryState = { failed: false };

  static getDerivedStateFromError(): ModuleBoundaryState { return { failed: true }; }

  componentDidCatch(error: Error) {
    console.error("Optional module icon failed to render.", error);
  }

  render() { return this.state.failed ? null : this.props.children; }
}

export function ModuleIconHost({ module }: { module: ModuleRegistration }) {
  const Icon = module.icon;
  return <ModuleIconBoundary><Icon size={18} strokeWidth={1.8} /></ModuleIconBoundary>;
}

export function ModuleHost({ module, context }: { module: ModuleRegistration; context: ModuleContext }) {
  const Module = module.component;
  return <ModuleBoundary key={module.id}><Suspense fallback={<section className="module-load-error" role="status">Loading {module.name}…</section>}><Module {...context} /></Suspense></ModuleBoundary>;
}

export function ModuleSettingsHost({ module, context }: { module: ModuleRegistration; context: ModuleSettingsContext }) {
  const Settings = module.settings;
  if (!Settings) return null;
  return <ModuleBoundary key={`${module.id}-settings`}><Suspense fallback={<section className="module-load-error" role="status">Loading {module.name} settings…</section>}><Settings {...context} /></Suspense></ModuleBoundary>;
}

export function ModuleNavigationHost({ module, context }: { module: ModuleRegistration; context: ModuleContext }) {
  const Navigation = module.navigation;
  if (!Navigation) return null;
  return <ModuleBoundary key={`${module.id}-navigation`}><Navigation context={context} /></ModuleBoundary>;
}
