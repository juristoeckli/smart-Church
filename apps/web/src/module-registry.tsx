import { Children, cloneElement, Component, isValidElement, lazy, Suspense, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { DepartmentProfile, UserLanguage } from "@smart-church/contracts";
import type { RealtimeEvent } from "./realtime";
import { translateFor, type TranslationKey } from "./i18n";

export interface ModuleRealtime {
  subscribe: (topic: string, listener: (event: RealtimeEvent) => void) => () => void;
  isConnected: () => boolean;
  send: (topic: string, payload?: unknown) => boolean;
}

export interface ModuleContext {
  language: UserLanguage;
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
  onNavigateEntity?: (type: "person" | "group" | "wiki" | "song", id: string) => void;
}

export interface ModuleSettingsContext {
  language: UserLanguage;
  departmentId: string;
  csrfToken: string;
  departments: DepartmentProfile[];
}

export interface ModuleAccessContext {
  department: DepartmentProfile;
  canManageSite: boolean;
}

export interface ModuleNavigationItem {
  id: string;
  label: string;
  state: string;
  parentId?: string;
}

export interface ModuleRegistration {
  id: string;
  name: string;
  translations?: Partial<Record<UserLanguage, Record<string, string>>>;
  icon: LucideIcon;
  required?: boolean;
  adminOnly?: boolean;
  enabledByDefault?: boolean;
  hiddenFromNavigation?: boolean;
  initialState?: string;
  accessLabel?: string;
  accessLevels?: Array<{ value: string; label: string; description?: string }>;
  isAvailable?: (context: ModuleAccessContext) => boolean;
  component: ComponentType<ModuleContext>;
  settings?: ComponentType<ModuleSettingsContext>;
  navigation?: ComponentType<{ context: ModuleContext }>;
  navigationItems?: (context: ModuleContext) => ModuleNavigationItem[];
  pageClassName?: string;
}

export function moduleTranslation(translations: ModuleRegistration["translations"], language: UserLanguage, key: string, englishFallback = key): string {
  return translations?.[language]?.[key] ?? translations?.en?.[key] ?? englishFallback;
}

export function translateModuleText(value: string, translations: ModuleRegistration["translations"], language: UserLanguage): string {
  const match = value.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!match) return value;
  const [, before, text, after] = match;
  const selected = translations?.[language] ?? {};
  const english = translations?.en ?? {};
  const exact = selected[text] ?? english[text];
  if (exact !== undefined) return `${before}${exact}${after}`;

  const templates = [...new Set([...Object.keys(selected), ...Object.keys(english)])].filter((key) => key.includes("{")).sort((left, right) => right.length - left.length);
  for (const template of templates) {
    const placeholders = [...template.matchAll(/\{([^{}]+)\}/g)];
    if (!placeholders.length) continue;
    const expression = template.split(/(\{[^{}]+\})/g).map((part) => part.startsWith("{") && part.endsWith("}")
      ? "([\\s\\S]+?)"
      : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("");
    const values = text.match(new RegExp(`^${expression}$`));
    const translated = selected[template] ?? english[template];
    if (!values || translated === undefined) continue;
    const replacements = new Map(placeholders.map((placeholder, index) => [placeholder[1], values[index + 1]]));
    const result = translated.replace(/\{([^{}]+)\}/g, (token, name: string) => replacements.get(name) ?? token);
    return `${before}${result}${after}`;
  }
  return value;
}

function translateModuleNode(node: ReactNode, translations: ModuleRegistration["translations"], language: UserLanguage): ReactNode {
  if (typeof node === "string") return translateModuleText(node, translations, language);
  if (Array.isArray(node)) return Children.map(node, (child) => translateModuleNode(child, translations, language));
  if (!isValidElement<{ children?: ReactNode }>(node)) return node;
  const props = node.props as Record<string, unknown>;
  if (props["data-no-translate"] === true) return node;
  const translatedProps: Record<string, unknown> = {};
  for (const attribute of ["aria-label", "aria-description", "title", "placeholder", "alt"] as const) {
    const value = props[attribute];
    if (typeof value === "string") translatedProps[attribute] = translateModuleText(value, translations, language);
  }
  return cloneElement(node, translatedProps, translateModuleNode(node.props.children, translations, language));
}

export function ModuleTranslationHost({ children, translations, language }: { children: ReactNode; translations: ModuleRegistration["translations"]; language: UserLanguage }) {
  return <>{Children.map(children, (child) => translateModuleNode(child, translations, language))}</>;
}

const registrations = import.meta.glob<{ moduleRegistration: ModuleRegistration }>(["./modules/*/module.tsx", "!./modules/amx/module.tsx", "!./modules/remote-desktop/module.tsx"]);

export const registeredModules: ModuleRegistration[] = [];
const loadedModules = new Map<string, Promise<ModuleRegistration | null>>();

async function loadOptionalModuleStylesheet(moduleId: string) {
  let link = document.querySelector<HTMLLinkElement>(`link[data-smart-church-module-css="${moduleId}"]`);
  if (!link) {
    link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `/optional-modules/${moduleId}/module.css`;
    link.dataset.smartChurchModuleCss = moduleId;
    const loaded = new Promise<void>((resolve, reject) => {
      link!.addEventListener("load", () => resolve(), { once: true });
      link!.addEventListener("error", () => reject(new Error(`Unable to load ${moduleId} module styles.`)), { once: true });
    });
    document.head.append(link);
    await loaded;
    return;
  }
  if (link.sheet) return;
  await new Promise<void>((resolve, reject) => {
    link!.addEventListener("load", () => resolve(), { once: true });
    link!.addEventListener("error", () => reject(new Error(`Unable to load ${moduleId} module styles.`)), { once: true });
  });
}

export async function loadRegisteredModules(moduleIds: string[]) {
  const requested = new Set(moduleIds.filter((moduleId) => /^[a-z0-9][a-z0-9-]*$/.test(moduleId)));
  const bundledMatches = Object.entries(registrations).filter(([path]) => requested.has(path.split("/").at(-2) ?? ""));
  const bundledIds = new Set(bundledMatches.map(([path]) => path.split("/").at(-2) ?? ""));
  const bundledModules = await Promise.all(bundledMatches.map(async ([path, load]) => {
    const moduleId = path.split("/").at(-2) ?? "";
    try {
      return [moduleId, (await load()).moduleRegistration] as const;
    } catch (error) {
      console.error(`Bundled module failed to load (${moduleId}); the remaining modules will continue.`, error);
      return [moduleId, null] as const;
    }
  }));
  // Any installed module absent from the core bundle is loaded from its own web bundle.
  // This lets a module ship from a separate repository without adding its ID to Core.
  const externalModuleIds = [...requested].filter((id) => !bundledIds.has(id));
  const optionalModules = await Promise.all(externalModuleIds.map(async (moduleId) => {
    try {
      await loadOptionalModuleStylesheet(moduleId);
      const { moduleRegistration } = await import(/* @vite-ignore */ `/optional-modules/${moduleId}/module.js`);
      return [moduleId, moduleRegistration as ModuleRegistration] as const;
    } catch (error) {
      console.error(`Optional module bundle failed to load (${moduleId}); the rest of Smart-Church will continue.`, error);
      return [moduleId, null] as const;
    }
  }));
  const modules = await Promise.all([...bundledModules, ...optionalModules].filter((module): module is readonly [string, ModuleRegistration] => module[1] !== null).map(([moduleId, moduleRegistration]) => {
    let pending = loadedModules.get(moduleId);
    if (!pending) {
      pending = Promise.resolve().then(() => {
        const iconType = typeof moduleRegistration?.icon;
        const componentType = typeof moduleRegistration?.component;
        if (!moduleRegistration || moduleRegistration.id !== moduleId || !/^[a-z0-9][a-z0-9-]*$/.test(moduleRegistration.id) || !moduleRegistration.name || moduleRegistration.icon == null || (iconType !== "function" && iconType !== "object") || moduleRegistration.component == null || (componentType !== "function" && componentType !== "object")) {
          throw new Error("The module registration is missing a valid ID, name, icon, or component.");
        }
        return moduleRegistration;
      }).catch((error: unknown) => {
        loadedModules.delete(moduleId);
        console.error(`Optional module registration failed (${moduleId}); the rest of Smart-Church will continue.`, error);
        return null;
      });
      loadedModules.set(moduleId, pending);
    }
    return pending;
  }));
  for (const module of modules) {
    if (module && !registeredModules.some((registered) => registered.id === module.id)) registeredModules.push(module);
  }
  return modules.filter((module): module is ModuleRegistration => module !== null);
}

interface ModuleBoundaryProps { children: ReactNode; language?: UserLanguage; }
interface ModuleBoundaryState { failed: boolean; }

class ModuleBoundary extends Component<ModuleBoundaryProps, ModuleBoundaryState> {
  state: ModuleBoundaryState = { failed: false };

  static getDerivedStateFromError(): ModuleBoundaryState { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Optional module failed to load.", error, info.componentStack);
  }

  render() {
    if (this.state.failed) return <section className="module-load-error" role="alert"><h2>{translateFor(this.props.language ?? "en", "module.loadFailedTitle" as TranslationKey)}</h2><p>{translateFor(this.props.language ?? "en", "module.loadFailedBody" as TranslationKey)}</p></section>;
    return this.props.children;
  }
}

class ModuleIconBoundary extends Component<{ children: ReactNode }, ModuleBoundaryState> {
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
  return <ModuleBoundary key={module.id} language={context.language}><ModuleTranslationHost translations={module.translations} language={context.language}><Suspense fallback={<section className="module-load-error" role="status">{translateFor(context.language, "module.loading" as TranslationKey)}</section>}><Module {...context} /></Suspense></ModuleTranslationHost></ModuleBoundary>;
}

export function ModuleSettingsHost({ module, context }: { module: ModuleRegistration; context: ModuleSettingsContext }) {
  const Settings = module.settings;
  if (!Settings) return null;
  return <ModuleBoundary key={`${module.id}-settings`} language={context.language}><ModuleTranslationHost translations={module.translations} language={context.language}><Suspense fallback={<section className="module-load-error" role="status">{translateFor(context.language, "module.settingsLoading" as TranslationKey)}</section>}><Settings {...context} /></Suspense></ModuleTranslationHost></ModuleBoundary>;
}

export function ModuleNavigationHost({ module, context }: { module: ModuleRegistration; context: ModuleContext }) {
  const Navigation = module.navigation;
  if (!Navigation) return null;
  return <ModuleBoundary key={`${module.id}-navigation`} language={context.language}><ModuleTranslationHost translations={module.translations} language={context.language}><Navigation context={context} /></ModuleTranslationHost></ModuleBoundary>;
}
