import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Bell,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  Church,
  CircleHelp,
  ContactRound,
  Copy,
  LayoutDashboard,
  KeyRound,
  Languages,
  Link2,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  Plus,
  Pencil,
  Search,
  Server,
  Settings2,
  SlidersHorizontal,
  Sun,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import type { AuthenticatedUser, AuthStatus, Contact, ContactStatus, CreateSiteUser, DepartmentProfile, HttpAccessMode, LocationPermission, PresenterPermission, ServerPermission, SiteUser, UserPhoneLabel, UserPhoneNumber, UserRelationshipInput, UserRelationshipKind, VideoPermission } from "@smart-church/contracts";
import { Authentication, PasswordChangeRequired } from "./Authentication";
import { SelfSignupPage } from "./SelfSignup";
import { SelfSignupAdmin } from "./SelfSignupAdmin";
import { ServicesEvents } from "./ServicesEvents";
import { mergeModuleTranslationOverrides, translateKnownModuleUiOverrideMessage } from "./modules/ui-translation-overrides";
import { PublicEventRegistration } from "./PublicEventRegistration";
import { PublicGroupSignup } from "./PublicGroupSignup";
import { Overview } from "./Overview";
import { smartChurchBuildInfo } from "./build-info";
import { Groups } from "./Groups";
import { BookableResources } from "./BookableResources";
import { ModuleHost, ModuleIconHost, ModuleNavigationHost, ModuleSettingsHost, ModuleTranslationHost, moduleRegistryReady, moduleTranslation, registeredModules, translateModuleText } from "./module-registry";
import { translateKnownModuleMessage, translateModuleMessage, translationsForModule } from "./modules/translations";
import { PresenterRightsFieldset } from "./modules/presenter/PresenterRightsFieldset";
import { LocationAccess } from "./LocationAccess";
import { RuntimeDiagnosticsPanel } from "./RuntimeDiagnosticsPanel";
import { UserSessions } from "./UserSessions";
import { ServerEmailSettings } from "./ServerEmailSettings";
import { ServerPermissionsFieldset } from "./ServerPermissionsFieldset";
import { ApiKeySettings } from "./ApiKeySettings";
import { OwnedServiceUsers } from "./OwnedServiceUsers";
import { configureRealtime, isRealtimeConnected, sendRealtime, subscribeRealtime } from "./realtime";
import { defaultDateTimeFormat, formatUserDate, setUserDateTimeFormat } from "./date-format";
import { browserDefaultLanguage, setActiveLanguage, translate, translateFor } from "./i18n";

const navigation = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "People", icon: UsersRound },
  { label: "Services & events", icon: CalendarDays },
  { label: "Groups", icon: ContactRound },
  { label: "Resources", icon: Building2 },
];
const videoPermissionOptions: Array<{ value: VideoPermission; label: string; description: string }> = [
  { value: "video_basic", label: "Video Basic", description: "View streaming, routing, status and history." },
  { value: "streaming_operator", label: "Streaming Operator", description: "Start and stop streams; trigger Shelly power cycles." },
  { value: "stream_admin", label: "Stream Admin", description: "Change encoder settings and streaming profiles." },
  { value: "routing_user", label: "Routing User", description: "Change routes and manage routing presets." },
  { value: "routing_admin", label: "Routing Admin", description: "Lock routes and rename sources and destinations." },
];
const locationPermissionOptions: Array<{ value: LocationPermission; label: string; description: string }> = [
  { value: "people_view_private", label: "View private contact details", description: "See email addresses and phone numbers in People." },
  { value: "people_manage", label: "Manage people", description: "Add, edit, delete and import people." },
  { value: "events_manage", label: "Manage services and events", description: "Create, edit and delete schedule entries." },
  { value: "groups_manage", label: "Manage groups", description: "Create groups and manage their membership." },
  { value: "resources_manage", label: "Manage resources", description: "Manage rooms, equipment and booking approvals." },
];
const defaultLogoUrl = "/gfc-logo.svg";
const initialPasswordCharacters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
const defaultDepartment: DepartmentProfile = {
  id: "",
  location: "Location not configured",
  timeZone: "Europe/Zurich",
  role: "member",
};

function departmentFetch(input: RequestInfo | URL, init: RequestInit = {}, departmentId = "") {
  const headers = new Headers(init.headers);
  if (departmentId) headers.set("x-department-id", departmentId);
  return fetch(input, { ...init, headers });
}

type WorkspacePage = "Overview" | "People" | "Services & events" | "Groups" | "Resources" | "Settings" | `module:${string}`;
type ChatNotification = { id: string; conversationId: string; author: string; body: string; receivedAt: number };
const SYSTEM_NOTIFICATIONS_STORAGE_KEY = "smart-church-system-notifications";
const modulePage = (id: string) => `module:${id}` as WorkspacePage;
const moduleForPage = (page: WorkspacePage) => page.startsWith("module:") ? registeredModules.find((module) => module.id === page.slice("module:".length)) : undefined;
function moduleAvailable(module: (typeof registeredModules)[number], department: DepartmentProfile, canManageSite: boolean) {
  const enabled = Boolean(module.required) || (department.enabledModules ?? []).includes(module.id);
  if (!enabled || (module.adminOnly && !canManageSite)) return false;
  try { return module.isAvailable?.({ department, canManageSite }) ?? true; }
  catch (error) { console.error(`Optional module availability check failed (${module.id}); the module will stay hidden.`, error); return false; }
}
function savedModuleState(moduleId: string, departmentId: string, fallback: string) {
  if (!departmentId) return fallback;
  try {
    const saved = localStorage.getItem(`smart-church-module-state:${moduleId}:${departmentId}`);
    if (saved !== null) return saved;
    if (moduleId === "video-steffisburg") return localStorage.getItem(`smart-church-video-tab:${departmentId}`) ?? fallback;
  } catch { /* Use the module default when storage is unavailable. */ }
  return fallback;
}
type PersonLinkOption = Pick<Contact, "id" | "firstName" | "lastName" | "email" | "importedFrom"> & { departmentId: string };
const workspacePageHashes: Record<WorkspacePage, string> = {
  Overview: "#overview",
  People: "#people",
  "Services & events": "#services-events",
  Groups: "#groups",
  Resources: "#resources",
  Settings: "#settings",
};
function workspacePageFromHash(hash: string): WorkspacePage | null {
  const entry = Object.entries(workspacePageHashes).find(([, route]) => route === hash);
  if (entry) return entry[0] as WorkspacePage;
  const oldModuleHash = { "#video-streaming": "video-steffisburg", "#module-video": "video-steffisburg", "#presenter": "presenter", "#sync": "sync", "#system-laptop": "remote-desktop", "#file-storage": "file-storage" }[hash as "#video-streaming" | "#module-video" | "#presenter" | "#sync" | "#system-laptop" | "#file-storage"];
  const parsedModuleId = hash.match(/^#module-([a-z0-9][a-z0-9-]*)$/)?.[1];
  const moduleId = ({ video: "video-steffisburg", "system-laptop": "remote-desktop" } as Record<string, string>)[parsedModuleId ?? ""] ?? parsedModuleId ?? oldModuleHash;
  return moduleId && registeredModules.some((module) => module.id === moduleId) ? modulePage(moduleId) : null;
}
function workspacePageHash(page: WorkspacePage) {
  const module = moduleForPage(page);
  return module ? `#module-${module.id}` : workspacePageHashes[page as Exclude<WorkspacePage, `module:${string}`>];
}
function navigationLabel(label: string) {
  switch (label) {
    case "Overview": return translate("nav.overview");
    case "People": return translate("nav.people");
    case "Services & events": return translate("nav.events");
    case "Groups": return translate("nav.groups");
    case "Resources": return translate("nav.resources");
    case "Settings": return translate("nav.settings");
    default: return label;
  }
}
function savedWorkspacePage(): WorkspacePage {
  try {
    const saved = localStorage.getItem("smart-church-page");
    if (saved === "Overview" || saved === "Services & events" || saved === "Groups" || saved === "Resources") return saved;
    if (saved === "File storage") return modulePage("file-storage");
    if (saved === "module:video") return modulePage("video-steffisburg");
    if (saved?.startsWith("module:") && registeredModules.some((module) => module.id === saved.slice("module:".length))) return saved as WorkspacePage;
    const legacyModuleIds = { "Video & streaming": "video-steffisburg", Presenter: "presenter", Sync: "sync", "System Laptop": "remote-desktop", "system-laptop": "remote-desktop", "module:system-laptop": "remote-desktop" } as Record<string, string>;
    if (saved && registeredModules.some((module) => module.id === legacyModuleIds[saved])) return modulePage(legacyModuleIds[saved]);
  } catch { /* Use the default page when local storage is unavailable. */ }
  return "People";
}

function initials(contact: Contact) {
  return `${contact.firstName[0] ?? ""}${contact.lastName[0] ?? ""}`.toUpperCase();
}

function importedProfileValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => importedProfileValue(item)).filter(Boolean).join(", ");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.customFields)) return importedProfileValue(record.customFields);
    if ("name" in record && record.name) return String(record.name);
    if ("value" in record) return String(record.value ?? "");
    return JSON.stringify(record);
  }
  return value === null || value === undefined ? "" : String(value);
}

const importedProfileLabels: Record<string, string> = {
  preferredName: "Preferred name", middleName: "Middle name", categoryId: "Category ID", accountStatus: "Account status",
  country: "Country", timezone: "Time zone", familyId: "Family ID", familyRelationship: "Family relationship",
  birthday: "Birthday", anniversary: "Anniversary", gender: "Gender", schoolGrade: "School grade",
  maritalStatus: "Marital status", mailingAddress: "Mailing address", archived: "Archived", contact: "Contact",
  volunteer: "Volunteer", developmentChild: "Development child", specialNeedsChild: "Special needs child",
  demographics: "Demographics", serviceTypes: "Service types", locations: "Locations", customFields: "Custom fields",
};

function parseContactsCsv(source: string): Array<Omit<Contact, "id">> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const text = source.replace(/^\uFEFF/, "");
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (quoted) throw new Error("This CSV has an unfinished quoted field.");
  if (rows.length < 2) throw new Error("The CSV needs a header and at least one person.");
  const headers = rows[0].map((header) => header.toLocaleLowerCase().replace(/[^a-z]/g, ""));
  const firstNameIndex = headers.indexOf("firstname");
  const lastNameIndex = headers.indexOf("lastname");
  if (firstNameIndex < 0 || lastNameIndex < 0) throw new Error("The CSV needs “firstName” and “lastName” columns.");
  const at = (values: string[], name: string) => { const column = headers.indexOf(name); return column < 0 ? "" : values[column] ?? ""; };
  return rows.slice(1).filter((values) => values.some(Boolean)).map((values) => {
    const statusValue = at(values, "status").toLocaleLowerCase();
    const status: ContactStatus = statusValue === "visitor" ? "visitor" : "member";
    const firstName = values[firstNameIndex] ?? "";
    const lastName = values[lastNameIndex] ?? "";
    if (!firstName || !lastName) throw new Error("Every CSV row needs a first and last name.");
    const email = at(values, "email");
    const phone = at(values, "phone");
    return { firstName, lastName, ...(email ? { email } : {}), ...(phone ? { phone } : {}), status };
  });
}

function generateInitialPassword() {
  const limit = Math.floor(256 / initialPasswordCharacters.length) * initialPasswordCharacters.length;
  const password: string[] = [];
  while (password.length < 12) {
    const values = new Uint8Array(16);
    window.crypto.getRandomValues(values);
    for (const value of values) {
      if (value < limit) password.push(initialPasswordCharacters[value % initialPasswordCharacters.length]);
      if (password.length === 12) break;
    }
  }
  return password.join("");
}

function WorkspaceApp() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      return localStorage.getItem("smart-church-theme") === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });
  const [systemNotificationsEnabled, setSystemNotificationsEnabled] = useState(() => {
    try { return localStorage.getItem(SYSTEM_NOTIFICATIONS_STORAGE_KEY) === "true" && typeof Notification !== "undefined" && Notification.permission === "granted"; }
    catch { return false; }
  });
  const [systemNotificationPermission, setSystemNotificationPermission] = useState<NotificationPermission>(() =>
    typeof Notification === "undefined" ? "denied" : Notification.permission,
  );
  const [systemNotificationFeedback, setSystemNotificationFeedback] = useState("");
  const [personalPreferenceFeedback, setPersonalPreferenceFeedback] = useState("");
  const [dateTimeFormatDraft, setDateTimeFormatDraft] = useState<AuthenticatedUser["dateTimeFormat"]>(defaultDateTimeFormat);
  const [isSavingDateTimeFormat, setIsSavingDateTimeFormat] = useState(false);
  const [languageDraft, setLanguageDraft] = useState<AuthenticatedUser["language"] | "auto">("auto");
  const [isSavingLanguage, setIsSavingLanguage] = useState(false);
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ContactStatus>("all");
  const [contactSort, setContactSort] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState<WorkspacePage>(() => workspacePageFromHash(window.location.hash) ?? savedWorkspacePage());
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [requestedChatConversationId, setRequestedChatConversationId] = useState<string | null>(null);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [chatNotifications, setChatNotifications] = useState<ChatNotification[]>([]);
  const deliveredSystemChatNotifications = useRef(new Set<string>());
  const activeChatIdRef = useRef<string | null>(null);
  const pageRef = useRef<WorkspacePage>(page);
  activeChatIdRef.current = activeChatId;
  pageRef.current = page;
  const [modulesReady, setModulesReady] = useState(false);
  const [moduleState, setModuleState] = useState<{ moduleId: string; departmentId: string; value: string }>({ moduleId: "", departmentId: "", value: "" });
  const [compactNavigation, setCompactNavigation] = useState(() => window.innerHeight < 900);
  const [collapsedNavSections, setCollapsedNavSections] = useState({ core: false, modules: false });
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const contactImportInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoUnavailable, setLogoUnavailable] = useState(false);
  const [isBrandingOpen, setIsBrandingOpen] = useState(false);
  const [brandingDraft, setBrandingDraft] = useState<string | null>(null);
  const [isBrandingSaving, setIsBrandingSaving] = useState(false);
  const [serverSettingsTab, setServerSettingsTab] = useState<"overview" | "personal" | "location" | "switch" | "sites" | "users" | "modules" | "server">("personal");
  const [selfSignupEnabled, setSelfSignupEnabled] = useState(false);
  const [selfSignupSites, setSelfSignupSites] = useState<Array<{ id: string; name: string }>>([]);
  const [serviceStatus, setServiceStatus] = useState<{ api: "ok" | "unavailable"; database: "ok" | "unavailable" } | null>(null);
  const [httpAccessMode, setHttpAccessMode] = useState<HttpAccessMode>("none");
  const [httpAccessModeDraft, setHttpAccessModeDraft] = useState<HttpAccessMode>("none");
  const [httpsOrigin, setHttpsOrigin] = useState<string | null>(null);
  const [isHttpAccessSaving, setIsHttpAccessSaving] = useState(false);
  const [httpAccessFeedback, setHttpAccessFeedback] = useState("");
  const [moduleManagementSiteId, setModuleManagementSiteId] = useState("");
  const [moduleDraftIds, setModuleDraftIds] = useState<string[]>([]);
  const [selectedModuleSettingsId, setSelectedModuleSettingsId] = useState("");
  const [isModuleSaving, setIsModuleSaving] = useState(false);
  const [moduleManagementFeedback, setModuleManagementFeedback] = useState("");
  const [department, setDepartment] = useState<DepartmentProfile>(defaultDepartment);
  const [departments, setDepartments] = useState<DepartmentProfile[]>([]);
  const [departmentDraft, setDepartmentDraft] = useState(defaultDepartment);
  const [isAddingLocation, setIsAddingLocation] = useState(false);
  const [isDepartmentSaving, setIsDepartmentSaving] = useState(false);
  const [siteUsers, setSiteUsers] = useState<SiteUser[]>([]);
  const [peopleOptions, setPeopleOptions] = useState<PersonLinkOption[]>([]);
  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [isUserSaving, setIsUserSaving] = useState(false);
  const [isUserDeleting, setIsUserDeleting] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordSaved, setResetPasswordSaved] = useState(false);
  const [isPasswordResetting, setIsPasswordResetting] = useState(false);
  const [userAccessFeedback, setUserAccessFeedback] = useState<{ message: string; isError: boolean } | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userMemberships, setUserMemberships] = useState<Record<string, { role: "site_admin" | "member"; contactId?: string; permissions: LocationPermission[]; videoPermissions: VideoPermission[]; presenterPermissions: PresenterPermission[]; modulePermissions?: Record<string, string[]> }>>({});
  const [userPhoneNumbers, setUserPhoneNumbers] = useState<UserPhoneNumber[]>([]);
  const [userRelationships, setUserRelationships] = useState<UserRelationshipInput[]>([]);
  const [serverPermissionsDraft, setServerPermissionsDraft] = useState<ServerPermission[]>([]);
  const [isServiceUserDraft, setIsServiceUserDraft] = useState(false);
  const [serviceUserOwnerIdDraft, setServiceUserOwnerIdDraft] = useState("");
  const [isAccountEnabledDraft, setIsAccountEnabledDraft] = useState(true);
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [isPasswordSaved, setIsPasswordSaved] = useState(false);
  const [newAccountRole, setNewAccountRole] = useState<"server_admin" | "user">("user");
  const [authLoading, setAuthLoading] = useState(true);
  const [authUser, setAuthUser] = useState<AuthenticatedUser | null>(null);
  const [csrfToken, setCsrfToken] = useState("");
  const [setupRequired, setSetupRequired] = useState(false);
  const [setupLocation, setSetupLocation] = useState("");
  const [authUnavailableMessage, setAuthUnavailableMessage] = useState("");

  useEffect(() => {
    configureRealtime(department.id, Boolean(authUser && !authUser.mustChangePassword));
    return () => configureRealtime("", false);
  }, [authUser?.id, authUser?.mustChangePassword, department.id]);

  const moduleRealtime = useMemo(() => ({ subscribe: subscribeRealtime, isConnected: isRealtimeConnected, send: sendRealtime }), []);

  const onActiveChatChange = useCallback((conversationId: string | null) => setActiveChatId(conversationId), []);
  const onChatConversationOpened = useCallback((conversationId: string) => {
    setRequestedChatConversationId((current) => current === conversationId ? null : current);
  }, []);
  const refreshCsrfToken = useCallback(async () => {
    const response = await fetch("/api/auth/status", { cache: "no-store" });
    const result = await response.json() as AuthStatus | { error?: string };
    if (!response.ok || !("authenticated" in result) || !result.authenticated || !result.csrfToken || result.user?.id !== authUser?.id) {
      throw new Error("Your sign-in expired. Refresh the page and sign in again.");
    }
    setCsrfToken(result.csrfToken);
    return result.csrfToken;
  }, [authUser?.id]);

  const logoSrc = logoDataUrl || defaultLogoUrl;
  const activeNavSection = page.startsWith("module:") ? "modules" : "core";

  useEffect(() => {
    if (!authUser || !department.id) {
      setUnreadChatCount(0);
      setChatNotifications([]);
      return;
    }
    let cancelled = false;
    let initialized = false;
    const seenUnreadIds = new Set<string>();
    async function refreshChatNotifications() {
      try {
        const response = await fetch("/api/modules/chat/conversations", { headers: { "x-department-id": department.id } });
        const result = await response.json() as { conversations?: Array<{ id: string; unreadCount: number; latestUnreadMessage?: { id: string; body: string; author: string } | null }> };
        if (!response.ok || !Array.isArray(result.conversations) || cancelled) return;
        const conversations = result.conversations;
        setUnreadChatCount(conversations.reduce((count, conversation) => count + conversation.unreadCount, 0));
        const unread = conversations.flatMap((conversation) => conversation.latestUnreadMessage
          ? [{ conversationId: conversation.id, ...conversation.latestUnreadMessage }]
          : []);
        if (!initialized) {
          unread.forEach((message) => seenUnreadIds.add(message.id));
          initialized = true;
          return;
        }
        const notifications = unread.filter((message) => !seenUnreadIds.has(message.id)).map((message) => {
          seenUnreadIds.add(message.id);
          return { ...message, receivedAt: Date.now() };
        }).filter((message) => !(pageRef.current === "module:chat" && activeChatIdRef.current === message.conversationId));
        if (seenUnreadIds.size > 500) {
          const recentIds = unread.map((message) => message.id);
          seenUnreadIds.clear();
          recentIds.forEach((id) => seenUnreadIds.add(id));
        }
        if (notifications.length) setChatNotifications((current) => [...current, ...notifications].slice(-3));
      } catch { /* Chat alerts are best effort; the sidebar count refreshes when the API is available. */ }
    }
    void refreshChatNotifications();
    const unsubscribeChanged = subscribeRealtime("module:chat:changed", () => { void refreshChatNotifications(); });
    const unsubscribeConnected = subscribeRealtime("realtime:connected", () => { void refreshChatNotifications(); });
    return () => { cancelled = true; unsubscribeChanged(); unsubscribeConnected(); };
  }, [authUser?.id, csrfToken, department.id]);

  useEffect(() => {
    if (!chatNotifications.length) return;
    const timer = window.setInterval(() => {
      setChatNotifications((current) => current.filter((notification) => Date.now() - notification.receivedAt < 9000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [chatNotifications.length > 0]);

  useEffect(() => {
    if (!systemNotificationsEnabled || systemNotificationPermission !== "granted" || !chatNotifications.length) return;
    const deliveredIds: string[] = [];
    for (const notification of chatNotifications) {
      if (deliveredSystemChatNotifications.current.has(notification.id)) {
        deliveredIds.push(notification.id);
        continue;
      }
      try {
        const systemNotification = new Notification(notification.author, {
          body: notification.body,
          tag: `smart-church-chat-${notification.id}`,
        });
        deliveredSystemChatNotifications.current.add(notification.id);
        deliveredIds.push(notification.id);
        systemNotification.onclick = () => {
          window.focus();
          setRequestedChatConversationId(notification.conversationId);
          setPage(modulePage("chat"));
          systemNotification.close();
        };
      } catch { /* Keep the in-app alert if the browser cannot display a system notification. */ }
    }
    if (deliveredIds.length) {
      setChatNotifications((current) => current.filter((notification) => !deliveredIds.includes(notification.id)));
    }
    if (deliveredSystemChatNotifications.current.size > 500) deliveredSystemChatNotifications.current.clear();
  }, [chatNotifications, systemNotificationPermission, systemNotificationsEnabled]);

  async function updateSystemNotifications(enabled: boolean) {
    setSystemNotificationFeedback("");
    if (!enabled) {
      setSystemNotificationsEnabled(false);
      try { localStorage.setItem(SYSTEM_NOTIFICATIONS_STORAGE_KEY, "false"); } catch { /* The setting remains off until this page closes. */ }
      return;
    }
    if (typeof Notification === "undefined" || !window.isSecureContext) {
      setSystemNotificationFeedback("System notifications are not supported in this browser or connection.");
      return;
    }
    let permission = Notification.permission;
    if (permission === "default") {
      try { permission = await Notification.requestPermission(); }
      catch { permission = "denied"; }
    }
    setSystemNotificationPermission(permission);
    if (permission !== "granted") {
      setSystemNotificationsEnabled(false);
      setSystemNotificationFeedback("Allow notifications for this site in your browser settings, then turn this on again.");
      return;
    }
    setSystemNotificationsEnabled(true);
    try { localStorage.setItem(SYSTEM_NOTIFICATIONS_STORAGE_KEY, "true"); }
    catch { setSystemNotificationFeedback("System notifications are on for this session, but this browser could not save the preference."); }
  }

  useEffect(() => {
    let active = true;
    void moduleRegistryReady.then(() => {
      if (!active) return;
      setModulesReady(true);
      const routePage = workspacePageFromHash(window.location.hash);
      const savedPage = savedWorkspacePage();
      if (routePage?.startsWith("module:")) setPage(routePage);
      else if (savedPage.startsWith("module:")) setPage(savedPage);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const updateNavigationDensity = () => setCompactNavigation(window.innerHeight < 900);
    window.addEventListener("resize", updateNavigationDensity);
    return () => window.removeEventListener("resize", updateNavigationDensity);
  }, []);

  useEffect(() => {
    if (compactNavigation) setCollapsedNavSections({ core: activeNavSection !== "core", modules: activeNavSection !== "modules" });
    else setCollapsedNavSections({ core: false, modules: false });
  }, [activeNavSection, compactNavigation]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("smart-church-theme", theme);
    } catch {
      // The theme remains usable when storage is disabled.
    }
  }, [theme]);

  async function saveDateTimeFormat(dateTimeFormat: AuthenticatedUser["dateTimeFormat"]) {
    if (!authUser) return;
    setIsSavingDateTimeFormat(true);
    try {
      const response = await fetch("/api/auth/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ dateTimeFormat }),
      });
      const result = await response.json() as { dateTimeFormat?: AuthenticatedUser["dateTimeFormat"]; error?: string };
      if (!response.ok || !result.dateTimeFormat) throw new Error(result.error ?? "Could not save date and time format.");
      setAuthUser((current) => current ? { ...current, dateTimeFormat: result.dateTimeFormat! } : current);
      setPersonalPreferenceFeedback(translate("settings.personal.formatSaved"));
    } catch (reason) {
      setPersonalPreferenceFeedback(reason instanceof Error ? reason.message : "Could not save date and time format.");
    } finally {
      setIsSavingDateTimeFormat(false);
    }
  }

  async function saveLanguage(language: AuthenticatedUser["language"] | null): Promise<boolean> {
    if (!authUser) return false;
    setIsSavingLanguage(true);
    try {
      const response = await fetch("/api/auth/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ language }),
      });
      const result = await response.json() as { language?: AuthenticatedUser["language"]; languageIsCustom?: boolean; error?: string };
      if (!response.ok || !result.language) throw new Error(result.error ?? "Could not save language.");
      const languageIsCustom = result.languageIsCustom ?? language !== null;
      setAuthUser((current) => current ? { ...current, language: result.language!, languageIsCustom } : current);
      setLanguageDraft(languageIsCustom ? result.language : "auto");
      setPersonalPreferenceFeedback(translateFor(languageIsCustom ? result.language : browserDefaultLanguage(), "settings.personal.languageSaved"));
      return true;
    } catch (reason) {
      setPersonalPreferenceFeedback(reason instanceof Error ? reason.message : "Could not save language.");
      return false;
    } finally {
      setIsSavingLanguage(false);
    }
  }

  async function selectHeaderLanguage(language: AuthenticatedUser["language"] | null) {
    if (await saveLanguage(language)) setIsLanguageMenuOpen(false);
  }

  useEffect(() => {
    if (page !== "Settings" || serverSettingsTab !== "overview") return;
    let cancelled = false;
    const refreshStatus = async () => {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        const result = await response.json() as { services?: { api?: string; database?: string } };
        if (!cancelled) setServiceStatus({ api: response.ok ? "ok" : "unavailable", database: result.services?.database === "ok" ? "ok" : "unavailable" });
      } catch {
        if (!cancelled) setServiceStatus({ api: "unavailable", database: "unavailable" });
      }
    };
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 30000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [page, serverSettingsTab]);

  useEffect(() => {
    try { localStorage.setItem("smart-church-page", page); } catch { /* Keep the current page for this session. */ }
  }, [page]);

  const activeModuleForState = moduleForPage(page);
  const activeModuleState = activeModuleForState
    ? moduleState.moduleId === activeModuleForState.id && moduleState.departmentId === department.id
      ? moduleState.value
      : savedModuleState(activeModuleForState.id, department.id, activeModuleForState.initialState ?? "")
    : "";
  useEffect(() => {
    if (!activeModuleForState || !department.id || moduleState.moduleId !== activeModuleForState.id || moduleState.departmentId !== department.id) return;
    try { localStorage.setItem(`smart-church-module-state:${activeModuleForState.id}:${department.id}`, moduleState.value); } catch { /* Keep module navigation usable for this session. */ }
  }, [activeModuleForState, department.id, moduleState]);

  useEffect(() => {
    if (!modulesReady) return;
    const hash = workspacePageHash(page);
    if (window.location.hash !== hash) window.location.hash = hash;
  }, [modulesReady, page]);

  useEffect(() => {
    const restorePageFromUrl = () => {
      const routePage = workspacePageFromHash(window.location.hash);
      if (routePage) setPage(routePage);
    };
    window.addEventListener("hashchange", restorePageFromUrl);
    return () => window.removeEventListener("hashchange", restorePageFromUrl);
  }, []);

  useEffect(() => {
    if (authUser && department.id) {
      try { localStorage.setItem("smart-church-location", department.id); } catch { /* Keep the current site for this session. */ }
    }
  }, [authUser, department.id]);

  useEffect(() => {
    const module = moduleForPage(page);
    if (authUser && department.id && departments.length > 0 && page.startsWith("module:") && (!module || !moduleAvailable(module, department, department.role === "site_admin"))) setPage("People");
  }, [authUser, department.id, department.role, department.videoPermissions, department.presenterPermissions, department.enabledModules, departments.length, page]);

  useEffect(() => {
    fetch("/api/auth/status")
      .then(async (response) => {
        const result = await response.json() as AuthStatus | { error?: string };
        if (!response.ok || !("authenticated" in result)) throw new Error("error" in result ? result.error ?? "Could not check sign-in status." : "Could not check sign-in status.");
        setSetupRequired(result.setupRequired);
        setSetupLocation(result.setupLocation ?? "");
        setSelfSignupEnabled(result.selfSignupEnabled ?? false);
        setSelfSignupSites(result.selfSignupSites ?? []);
        setAuthUser(result.user ?? null);
        setCsrfToken(result.csrfToken ?? "");
        setHttpAccessMode(result.httpAccessMode ?? "none");
        setHttpAccessModeDraft(result.httpAccessMode ?? "none");
        setHttpsOrigin(result.httpsOrigin ?? null);
      })
      .catch((error: unknown) => setAuthUnavailableMessage(error instanceof Error ? error.message : "The account service is unavailable."))
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (authUser) setDateTimeFormatDraft(authUser.dateTimeFormat ?? defaultDateTimeFormat);
  }, [authUser?.id]);

  useEffect(() => {
    if (authUser) setLanguageDraft(authUser.languageIsCustom ? authUser.language : "auto");
  }, [authUser?.id, authUser?.language, authUser?.languageIsCustom]);

  useEffect(() => {
    if (!authUser) return;
    if (!department.id) return;
    const controller = new AbortController();
    setIsLoading(true);
    setContacts([]);
    setLoadError("");
    const refreshContacts = async () => {
      try {
        const response = await departmentFetch("/api/contacts", { signal: controller.signal }, department.id);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not load contacts.");
        setContacts(result as Contact[]);
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Could not load contacts.");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };
    void refreshContacts();
    const unsubscribe = subscribeRealtime("core:contacts:changed", () => { void refreshContacts(); });
    const unsubscribeConnected = subscribeRealtime("realtime:connected", () => { void refreshContacts(); });
    return () => { controller.abort(); unsubscribe(); unsubscribeConnected(); };
  }, [authUser, department.id]);

  useEffect(() => {
    if (!authUser) return;
    fetch("/api/branding")
      .then(async (response) => {
        if (!response.ok) return;
        const result = await response.json() as { logoDataUrl: string | null };
        setLogoDataUrl(result.logoDataUrl);
      })
      .catch(() => {
        // The supplied GfC logo remains the default when local settings are unavailable.
      });
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;
    fetch("/api/departments")
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !Array.isArray(result)) throw new Error(result.error ?? "Could not load locations.");
        const availableDepartments = result as DepartmentProfile[];
        setDepartments(availableDepartments);
        let selectedId = "";
        try { selectedId = localStorage.getItem("smart-church-location") ?? ""; } catch { /* Use the first location when storage is unavailable. */ }
        const accessibleDepartments = availableDepartments.filter((item) => item.role !== "unassigned" || authUser.role === "server_admin");
        const selected = accessibleDepartments.find((item) => item.id === selectedId) ?? accessibleDepartments[0];
        if (selected) setDepartment(selected);
        else setDepartment(defaultDepartment);
      })
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : "Could not load locations."));
  }, [authUser]);

  useEffect(() => setLogoUnavailable(false), [logoSrc]);

  const visibleContacts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return contacts.filter((contact) => {
      const matchesStatus = statusFilter === "all" || contact.status === statusFilter;
      const matchesQuery = !normalizedQuery || [contact.firstName, contact.lastName, contact.email, contact.phone]
        .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
      return matchesStatus && matchesQuery;
    }).sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`) * (contactSort === "asc" ? 1 : -1));
  }, [contacts, query, statusFilter, contactSort]);

  async function addContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = String(formData.get("email")).trim();
    const phone = String(formData.get("phone")).trim();
    const payload = {
      firstName: String(formData.get("firstName")).trim(),
      lastName: String(formData.get("lastName")).trim(),
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      status: String(formData.get("status")) as ContactStatus,
    };
    setIsSaving(true);
    try {
      const response = await departmentFetch(editingContact ? `/api/contacts/${encodeURIComponent(editingContact.id)}` : "/api/contacts", {
        method: editingContact ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }, department.id);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save this person.");
      const contact = result as Contact;
      setContacts((current) => editingContact ? current.map((item) => item.id === contact.id ? contact : item) : [...current, contact]);
      setLoadError("");
      setIsAddOpen(false);
      setEditingContact(null);
      form.reset();
      setNotice(`${contact.firstName} ${contact.lastName} was ${editingContact ? "updated" : "saved"}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save this person.");
    } finally {
      setIsSaving(false);
    }
    window.setTimeout(() => setNotice(""), 4000);
  }

  async function importContactsCsv(file?: File) {
    if (!file || !(department.role === "site_admin" || (department.permissions ?? []).includes("people_manage"))) return;
    setIsSaving(true);
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("CSV files must be 2 MiB or smaller.");
      const imported = parseContactsCsv(await file.text());
      if (imported.length > 1000) throw new Error("Import up to 1,000 people at a time.");
      const response = await departmentFetch("/api/contacts/import", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contacts: imported }),
      }, department.id);
      const result = await response.json() as Contact[] | { error?: string };
      if (!response.ok || !Array.isArray(result)) throw new Error(!Array.isArray(result) ? result.error ?? "Could not import people." : "Could not import people.");
      setContacts((current) => [...current, ...result]);
      setNotice(`Imported ${result.length} ${result.length === 1 ? "person" : "people"}.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not import people."); }
    finally { setIsSaving(false); if (contactImportInput.current) contactImportInput.current.value = ""; }
  }

  async function deleteContact(contact: Contact) {
    if (!(department.role === "site_admin" || (department.permissions ?? []).includes("people_manage")) || !window.confirm(translateModuleText(`Delete ${contact.firstName} ${contact.lastName} from this site? This also removes them from their groups.`, translationsForModule("core-people"), activeLanguage))) return;
    try {
      const response = await departmentFetch(`/api/contacts/${encodeURIComponent(contact.id)}`, { method: "DELETE" }, department.id);
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not delete this person.");
      setContacts((current) => current.filter((item) => item.id !== contact.id));
      setNotice(`${contact.firstName} ${contact.lastName} was deleted.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not delete this person."); }
  }

  function openBrandingSettings() {
    setBrandingDraft(logoDataUrl);
    setIsBrandingOpen(true);
  }

  function selectBrandingLogo(file: File | undefined) {
    if (!file) return;
    if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(file.type)) {
      setNotice("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setNotice("The logo image must be under 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setBrandingDraft(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => setNotice("Could not read that logo image.");
    reader.readAsDataURL(file);
  }

  async function saveBranding() {
    setIsBrandingSaving(true);
    try {
      const uploadedLogo = typeof brandingDraft === "string" && brandingDraft.startsWith("data:image/")
        ? brandingDraft
        : null;
      const response = await fetch("/api/branding", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ logoDataUrl: uploadedLogo }),
      });
      const result = await response.json() as { logoDataUrl?: string | null; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not save site branding.");
      setLogoDataUrl(result.logoDataUrl ?? null);
      setIsBrandingOpen(false);
      setNotice("Site logo saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save site branding.");
    } finally {
      setIsBrandingSaving(false);
    }
    window.setTimeout(() => setNotice(""), 4000);
  }


  function switchDepartment(id: string) {
    const selected = departments.find((item) => item.id === id);
    if (!selected || (selected.role === "unassigned" && authUser?.role !== "server_admin")) return;
    setDepartment(selected);
    setDepartmentDraft(selected);
    setContacts([]);
    setPage("People");
    setQuery("");
    setStatusFilter("all");
    setIsAddOpen(false);
    try { localStorage.setItem("smart-church-location", selected.id); } catch { /* The selection remains active until the page reloads. */ }
  }

  async function saveDepartmentSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsDepartmentSaving(true);
    try {
      const response = await departmentFetch("/api/department", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ location: departmentDraft.location, timeZone: departmentDraft.timeZone }),
      }, department.id);
      const result = await response.json() as DepartmentProfile | { error?: string };
      if (!response.ok || !("id" in result)) throw new Error("error" in result ? result.error ?? "Could not save location settings." : "Could not save location settings.");
      setDepartment(result);
      setDepartments((current) => current.map((item) => item.id === result.id ? result : item));
        setNotice("Location settings saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save location settings.");
    } finally {
      setIsDepartmentSaving(false);
    }
    window.setTimeout(() => setNotice(""), 4000);
  }

  async function addLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const payload = { location: String(values.get("location")).trim(), timeZone: String(values.get("timeZone")).trim() };
    setIsDepartmentSaving(true);
    try {
      const response = await fetch("/api/departments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as DepartmentProfile | { error?: string };
      if (!response.ok || !("id" in result)) throw new Error("error" in result ? result.error ?? "Could not add this location." : "Could not add this location.");
      setDepartments((current) => [...current, result].sort((a, b) => a.location.localeCompare(b.location)));
      setDepartment(result);
      setDepartmentDraft(result);
      try { localStorage.setItem("smart-church-location", result.id); } catch { /* Keep the new location selected for this session. */ }
        setIsAddingLocation(false);
      setNotice(`${result.location} was added.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not add this location.");
    } finally {
      setIsDepartmentSaving(false);
    }
  }

  function openModuleManagement() {
    const site = departments.find((item) => item.id === department.id) ?? departments[0];
    setModuleManagementSiteId(site?.id ?? "");
    setModuleDraftIds(site?.enabledModules ?? []);
    setModuleManagementFeedback("");
    setSelectedModuleSettingsId("");
    setServerSettingsTab("modules");
  }

  function changeModuleManagementSite(siteId: string) {
    const site = departments.find((item) => item.id === siteId);
    setModuleManagementSiteId(siteId);
    setModuleDraftIds(site?.enabledModules ?? []);
    setModuleManagementFeedback("");
    setSelectedModuleSettingsId("");
  }

  async function saveModuleManagement() {
    setIsModuleSaving(true);
    setModuleManagementFeedback("");
    try {
      const response = await fetch("/api/installation/modules", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ moduleIds: moduleDraftIds }),
      });
      const result = await response.json() as { enabledModules?: string[]; error?: string };
      if (!response.ok || !Array.isArray(result.enabledModules)) throw new Error(result.error ?? "Could not save installation module settings.");
      setDepartments((current) => current.map((site) => ({ ...site, enabledModules: result.enabledModules ?? [] })));
      setDepartment((current) => ({ ...current, enabledModules: result.enabledModules ?? [] }));
      setModuleDraftIds(result.enabledModules ?? []);
      setModuleManagementFeedback("Installation module settings saved for all locations.");
    } catch (error) {
      setModuleManagementFeedback(error instanceof Error ? error.message : "Could not save module settings.");
    } finally {
      setIsModuleSaving(false);
    }
  }

  async function saveHttpAccessMode() {
    setIsHttpAccessSaving(true);
    setHttpAccessFeedback("");
    try {
      const csrfToken = await refreshCsrfToken();
      const response = await fetch("/api/admin/web-settings/http-access", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ mode: httpAccessModeDraft }),
      });
      const result = await response.json() as { mode?: HttpAccessMode; httpsOrigin?: string | null; error?: string };
      if (!response.ok || !result.mode) throw new Error(result.error ?? "Could not save HTTP access behavior.");
      setHttpAccessMode(result.mode);
      setHttpAccessModeDraft(result.mode);
      setHttpsOrigin(result.httpsOrigin ?? null);
      setHttpAccessFeedback("Web access behavior saved.");
      if (window.location.protocol === "http:") window.location.reload();
    } catch (error) {
      setHttpAccessFeedback(error instanceof Error ? error.message : "Could not save HTTP access behavior.");
    } finally {
      setIsHttpAccessSaving(false);
    }
  }

  async function openUserAccess() {
    setServerSettingsTab("users");
    setPage("Settings");
    setIsUsersLoading(true);
    try {
      const [response, peopleResponse] = await Promise.all([fetch("/api/users"), fetch("/api/people-options")]);
      const [rawUsers, rawPeople] = await Promise.all([response.json(), peopleResponse.json()]);
      const result = rawUsers as SiteUser[] | { error?: string };
      const peopleResult = rawPeople as PersonLinkOption[] | { error?: string };
      if (!response.ok || !Array.isArray(result)) throw new Error(!Array.isArray(result) ? result.error ?? "Could not load users." : "Could not load users.");
      if (!peopleResponse.ok || !Array.isArray(peopleResult)) throw new Error(!Array.isArray(peopleResult) ? peopleResult.error ?? "Could not load people for account linking." : "Could not load people for account linking.");
      setSiteUsers(result);
      setPeopleOptions(peopleResult);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load users.");
    } finally {
      setIsUsersLoading(false);
    }
  }

  function editSiteUser(user: SiteUser) {
    setUserAccessFeedback(null);
    setEditingUserId(user.id);
    setNewAccountRole(user.accountRole);
    setServerPermissionsDraft(user.accountRole === "server_admin" ? [] : user.serverPermissions ?? []);
    setIsServiceUserDraft(Boolean(user.isServiceUser));
    setServiceUserOwnerIdDraft(user.serviceUserOwnerId ?? authUser?.id ?? "");
    setIsAccountEnabledDraft(user.isEnabled);
    setUserMemberships(Object.fromEntries(user.memberships.map(({ departmentId, role, contactId, permissions, videoPermissions, presenterPermissions, modulePermissions }) => [departmentId, { role, contactId: contactId ?? undefined, permissions: permissions ?? [], videoPermissions: videoPermissions ?? [], presenterPermissions: presenterPermissions ?? [], modulePermissions: modulePermissions ?? {} }])));
    setUserPhoneNumbers(user.phoneNumbers ?? []);
    setUserRelationships((user.relationships ?? []).map(({ relatedUserId, relationship }) => ({ relatedUserId, relationship })));
    setGeneratedPassword("");
    setIsPasswordSaved(false);
    setIsResettingPassword(false);
    setResetPassword("");
    setResetPasswordSaved(false);
  }

  function startNewSiteUser() {
    setUserAccessFeedback(null);
    setEditingUserId(null);
    setNewAccountRole("user");
    setServerPermissionsDraft([]);
    setIsServiceUserDraft(false);
    setServiceUserOwnerIdDraft(authUser?.id ?? "");
    setIsAccountEnabledDraft(true);
    setUserMemberships(department.id ? { [department.id]: { role: "member", permissions: [], videoPermissions: [], presenterPermissions: [], modulePermissions: {} } } : {});
    setUserPhoneNumbers([]);
    setUserRelationships([]);
    setGeneratedPassword(generateInitialPassword());
    setIsPasswordSaved(false);
    setIsResettingPassword(false);
    setResetPassword("");
    setResetPasswordSaved(false);
  }

  async function saveSiteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const isCreatingUser = !editingUserId;
    const values = new FormData(event.currentTarget);
    const memberships = Object.entries(userMemberships).map(([departmentId, membership]) => ({ departmentId, ...membership }));
    if (!memberships.length && newAccountRole !== "server_admin") {
      setUserAccessFeedback({ message: "Assign this account to at least one site.", isError: true });
      setNotice("Assign this account to at least one site.");
      return;
    }
    const payload = {
      email: String(values.get("email") ?? "").trim() || undefined,
      username: String(values.get("username")).trim(),
      displayName: String(values.get("displayName")).trim(),
      birthday: String(values.get("birthday") ?? "").trim() || undefined,
      street: String(values.get("street") ?? "").trim() || undefined,
      streetNumber: String(values.get("streetNumber") ?? "").trim() || undefined,
      postalCode: String(values.get("postalCode") ?? "").trim() || undefined,
      city: String(values.get("city") ?? "").trim() || undefined,
      phoneNumbers: userPhoneNumbers.filter((phone) => phone.number.trim()).map((phone) => ({ ...phone, number: phone.number.trim() })),
      relationships: userRelationships.filter((relationship) => relationship.relatedUserId),
      memberships,
      adminNote: String(values.get("adminNote") ?? "").trim(),
      isEnabled: isAccountEnabledDraft,
      ...(!editingUserId ? { password: generatedPassword } : {}),
      accountRole: newAccountRole,
      ...(authUser?.role === "server_admin" ? { serverPermissions: serverPermissionsDraft } : {}),
      ...(authUser?.role === "server_admin" ? { isServiceUser: isServiceUserDraft } : {}),
      ...(authUser?.role === "server_admin" && isServiceUserDraft ? { serviceUserOwnerId: serviceUserOwnerIdDraft } : {}),
    } as CreateSiteUser;
    if (!editingUserId && generatedPassword.length < 12) {
      setUserAccessFeedback({ message: "Generate a password with at least 12 characters.", isError: true });
      setNotice("Generate a password with at least 12 characters.");
      return;
    }
    setUserAccessFeedback(null);
    setIsUserSaving(true);
    try {
      const response = await fetch(editingUserId ? `/api/users/${editingUserId}` : "/api/users", {
        method: editingUserId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as SiteUser | { error?: string };
      if (!response.ok || !("id" in result)) throw new Error("error" in result ? result.error ?? "Could not save user access." : "Could not save user access.");
      setSiteUsers((current) => editingUserId
        ? current.map((user) => user.id === result.id ? result : user)
        : [...current, result].sort((a, b) => a.displayName.localeCompare(b.displayName)));
      if (editingUserId === authUser?.id && result.accountRole !== authUser.role) {
        setAuthUser((current) => current ? { ...current, role: result.accountRole } : current);
        if (result.accountRole !== "server_admin") setServerSettingsTab("personal");
      }
      if (editingUserId === authUser?.id) {
        const membershipByDepartment = new Map(memberships.map((membership) => [membership.departmentId, membership]));
        setDepartments((current) => current.map((site) => {
          const membership = membershipByDepartment.get(site.id);
          return { ...site, role: membership?.role ?? "unassigned", permissions: membership?.permissions ?? [], videoPermissions: membership?.videoPermissions ?? [], presenterPermissions: membership?.presenterPermissions ?? [] };
        }));
        const nextSite = departments.find((site) => membershipByDepartment.has(site.id));
        if (nextSite) {
          const membership = membershipByDepartment.get(nextSite.id)!;
          setDepartment({ ...nextSite, role: membership.role, permissions: membership.permissions ?? [], videoPermissions: membership.videoPermissions ?? [], presenterPermissions: membership.presenterPermissions ?? [], modulePermissions: membership.modulePermissions ?? {} });
          try { localStorage.setItem("smart-church-location", nextSite.id); } catch { /* The selection remains active until the page reloads. */ }
        }
      }
      void fetch("/api/users").then(async (response) => {
        if (!response.ok) return;
        const refreshed = await response.json() as SiteUser[];
        setSiteUsers(refreshed);
      }).catch(() => { /* The saved profile remains available from the response. */ });
      setEditingUserId(result.id);
      setIsPasswordSaved(isCreatingUser);
      const message = editingUserId ? "User access updated." : "User account created.";
      setUserAccessFeedback({ message, isError: false });
      setNotice(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save user access.";
      setUserAccessFeedback({ message, isError: true });
      setNotice(message);
    } finally {
      setIsUserSaving(false);
    }
  }

  async function deleteSiteUser() {
    if (!editingUser || editingUser.id === authUser?.id) return;
    const confirmed = window.confirm(translateModuleText(`Delete ${editingUser.displayName} (@${editingUser.username})? Their account, site access, and active sessions will be removed.`, translationsForModule("core-admin"), activeLanguage));
    if (!confirmed) return;
    setUserAccessFeedback(null);
    setIsUserDeleting(true);
    try {
      const response = await fetch(`/api/users/${editingUser.id}`, { method: "DELETE" });
      const result = await response.json() as { id?: string; error?: string };
      if (!response.ok || result.id !== editingUser.id) throw new Error(result.error ?? "Could not delete this user.");
      setSiteUsers((current) => current.filter((user) => user.id !== editingUser.id));
      startNewSiteUser();
      const message = `${editingUser.displayName} was deleted.`;
      setUserAccessFeedback({ message, isError: false });
      setNotice(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not delete this user.";
      setUserAccessFeedback({ message, isError: true });
      setNotice(message);
    } finally {
      setIsUserDeleting(false);
    }
  }

  async function copyGeneratedPassword() {
    try {
      await navigator.clipboard.writeText(generatedPassword);
      setNotice("Generated password copied.");
    } catch {
      setNotice("Copy is unavailable in this browser. Select and copy the password manually.");
    }
  }

  async function copyResetPassword() {
    try {
      await navigator.clipboard.writeText(resetPassword);
      setUserAccessFeedback({ message: "Temporary password copied.", isError: false });
    } catch {
      setUserAccessFeedback({ message: "Copy is unavailable in this browser. Select and copy the password manually.", isError: true });
    }
  }

  async function resetSiteUserPassword() {
    if (!editingUser || editingUser.id === authUser?.id || resetPassword.length < 12) return;
    if (!window.confirm(translateModuleText(`Reset the password for ${editingUser.displayName}? Their active sessions will end.`, translationsForModule("core-admin"), activeLanguage))) return;
    setUserAccessFeedback(null);
    setIsPasswordResetting(true);
    try {
      const response = await fetch(`/api/users/${editingUser.id}/reset-password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: resetPassword }) });
      const result = await response.json() as { id?: string; error?: string };
      if (!response.ok || result.id !== editingUser.id) throw new Error(result.error ?? "Could not reset this password.");
      setResetPasswordSaved(true);
      setUserAccessFeedback({ message: "Password reset. The user must choose a new password at their next sign-in.", isError: false });
    } catch (error) {
      setUserAccessFeedback({ message: error instanceof Error ? error.message : "Could not reset this password.", isError: true });
    } finally {
      setIsPasswordResetting(false);
    }
  }

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Clear the local view even if the API has gone offline; the server session expires on its own.
    } finally {
      setAuthUser(null);
      setCsrfToken("");
      setContacts([]);
      setLogoDataUrl(null);
      setDepartment(defaultDepartment);
      setDepartments([]);
      setSiteUsers([]);
      setEditingUserId(null);
      setNewAccountRole("user");
      setUserMemberships({});
      setGeneratedPassword("");
      setIsPasswordSaved(false);
      setIsBrandingOpen(false);
        }
  }

  const memberCount = contacts.filter((contact) => contact.status === "member").length;
  const visitorCount = contacts.filter((contact) => contact.status === "visitor").length;

  if (window.location.pathname === "/signup" || window.location.pathname === "/signup/") return <SelfSignupPage confirmation={false} />;
  if (window.location.pathname === "/signup/confirm") return <SelfSignupPage confirmation />;
  if (authLoading) return <main className="auth-page"><section className="auth-card auth-loading" role="status"><span className="eyebrow">GFC WORKSPACE</span><p>Checking your sign-in…</p></section></main>;
  if (!authUser) return <Authentication setupRequired={setupRequired} setupLocation={setupLocation} selfSignupEnabled={selfSignupEnabled} selfSignupSites={selfSignupSites} unavailableMessage={authUnavailableMessage} onAuthenticated={(user) => { setAuthUnavailableMessage(""); setSetupRequired(false); setAuthUser(user); void fetch("/api/auth/status").then((response) => response.json()).then((result: AuthStatus) => { setCsrfToken(result.csrfToken ?? ""); setSelfSignupEnabled(result.selfSignupEnabled ?? false); setSelfSignupSites(result.selfSignupSites ?? []); }).catch(() => setCsrfToken("")); }} />;
  if (authUser.mustChangePassword) return <PasswordChangeRequired onChanged={setAuthUser} />;

  const userInitials = authUser.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || authUser.username[0]?.toUpperCase() || "U";
  const canManageSite = department.role === "site_admin";
  const hasLocationPermission = (permission: LocationPermission) => canManageSite || (department.permissions ?? []).includes(permission);
  const canManagePeople = hasLocationPermission("people_manage");
  const canManageEvents = hasLocationPermission("events_manage");
  const canManageGroups = hasLocationPermission("groups_manage");
  const canManageResources = hasLocationPermission("resources_manage");
  const activeLanguage = authUser.languageIsCustom ? authUser.language : browserDefaultLanguage();
  const hasServerPermission = (permission: ServerPermission) => authUser.role === "server_admin" || authUser.serverPermissions.includes(permission);
  const enabledDynamicModules = registeredModules.filter((module) => !module.hiddenFromNavigation && moduleAvailable(module, department, canManageSite));
  const selectedModuleSettings = registeredModules.find((module) => module.id === selectedModuleSettingsId && module.settings);
  const moduleContext = {
    language: activeLanguage,
    department,
    departmentId: department.id,
    csrfToken,
    realtime: moduleRealtime,
    systemNotificationsEnabled: systemNotificationsEnabled && systemNotificationPermission === "granted",
    canManageSite,
    state: activeModuleState,
    onStateChange: (value: string) => activeModuleForState && setModuleState({ moduleId: activeModuleForState.id, departmentId: department.id, value }),
    requestedChatConversationId,
    onChatConversationOpened,
    onActiveChatChange,
    refreshCsrfToken,
  };
  const renderNavigationItem = ({ label, icon: Icon }: typeof navigation[number]) => {
    const registered = registeredModules.find((module) => module.name === label);
    const targetPage = registered ? modulePage(registered.id) : label as WorkspacePage;
    const isAvailablePage = registered ? enabledDynamicModules.some((module) => module.id === registered.id) : label === "Overview" || label === "People" || label === "Services & events" || label === "Groups" || label === "Resources";
    const active = page === targetPage;
    return <button className={`nav-item ${active ? "nav-item-active" : ""}`} type="button" key={label} onClick={() => {
      if (isAvailablePage) {
        setPage(targetPage);
        setMenuOpen(false);
      } else setNotice(`${label} will be added in a later step.`);
    }}>
      {registered ? <ModuleIconHost module={registered} /> : <Icon size={18} strokeWidth={1.8} />}<span>{registered ? moduleTranslation(registered.translations, activeLanguage, "name", registered.name) : navigationLabel(label)}</span>{registered?.id === "chat" && unreadChatCount > 0 && <span className="nav-unread-badge" aria-label={`${unreadChatCount} unread ${unreadChatCount === 1 ? "message" : "messages"}`}>{unreadChatCount > 99 ? "99+" : unreadChatCount}</span>}{active && <span className="nav-indicator" />}
    </button>;
  };
  const editingUser = siteUsers.find((user) => user.id === editingUserId) ?? null;
  setUserDateTimeFormat(authUser.dateTimeFormat ?? defaultDateTimeFormat);
  setActiveLanguage(activeLanguage);
  const today = formatUserDate(new Date(), false, authUser.dateTimeFormat);

  return (
    <div className="app-frame">
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="brand-header">
          <a className="brand" href="#people" aria-label="Church home">
            {logoUnavailable ? <><span className="brand-mark"><Church size={21} strokeWidth={1.8} /></span><span className="brand-name">smart<span>church</span></span></> : <img className="brand-custom-logo" src={logoSrc} alt="GfC logo" onError={() => setLogoUnavailable(true)} />}
          </a>
          <button className="brand-location" type="button" aria-label={`Switch site. Current site: ${department.location}`} onClick={() => { setServerSettingsTab("switch"); setPage("Settings"); }}><span>{department.location}</span><ChevronDown size={15} aria-hidden="true" /></button>
        </div>

        <nav className="main-nav" aria-label={translate("nav.core")}>
          <section className="nav-category">
            <button className="nav-label nav-section-label nav-category-toggle" type="button" aria-expanded={!collapsedNavSections.core} onClick={() => setCollapsedNavSections((current) => ({ ...current, core: !current.core }))}><span>{translate("nav.core")}</span><ChevronDown size={13} aria-hidden="true" /></button>
            {!collapsedNavSections.core && <div className="nav-category-items">{navigation.map(renderNavigationItem)}<button className={`nav-item ${page === "Settings" ? "nav-item-active" : ""}`} type="button" onClick={() => { setServerSettingsTab("personal"); setMenuOpen(false); setPage("Settings"); }}><Settings2 size={18} strokeWidth={1.8} /><span>{translate("nav.settings")}</span></button></div>}
          </section>
          {enabledDynamicModules.length > 0 && <section className="nav-category">
            <button className="nav-label nav-section-label nav-module-label nav-category-toggle" type="button" aria-expanded={!collapsedNavSections.modules} onClick={() => setCollapsedNavSections((current) => ({ ...current, modules: !current.modules }))}><span>{translate("nav.modules")}</span><ChevronDown size={13} aria-hidden="true" /></button>
            {!collapsedNavSections.modules && <div className="nav-category-items">
              {enabledDynamicModules.map((module) => <div key={module.id}>{renderNavigationItem({ label: module.name, icon: module.icon })}{page === modulePage(module.id) && <ModuleNavigationHost module={module} context={moduleContext} />}</div>)}
            </div>}
          </section>}
        </nav>

        <div className="sidebar-bottom">


          <button className="nav-item" type="button" onClick={() => setNotice("Help will be added in a later step.")}><CircleHelp size={18} strokeWidth={1.8} /><span>Help & support</span></button>
        </div>
      </aside>

      {menuOpen && <button className="mobile-scrim" type="button" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}

      <main className="main-content">
        <header className="topbar">
          <button className="icon-button mobile-menu-button" type="button" aria-label="Open menu" onClick={() => setMenuOpen(true)}><Menu size={21} /></button>
          <div className="breadcrumbs"><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>{moduleForPage(page) ? moduleTranslation(moduleForPage(page)!.translations, activeLanguage, "name", moduleForPage(page)!.name) : page}</strong></div>
          <div className="topbar-actions"><span className="date-label">{today}</span><button className="icon-button topbar-bell" aria-label={translate("nav.notifications")} type="button" onClick={() => setNotice("You’re all caught up.")}><Bell size={19} /></button><div className="topbar-language-control"><button className="topbar-language-button" type="button" aria-label={translate("language.menu")} aria-haspopup="menu" aria-expanded={isLanguageMenuOpen} onClick={() => setIsLanguageMenuOpen((open) => !open)}><Languages size={16} /><span>{activeLanguage.toUpperCase()}</span><ChevronDown size={13} /></button>{isLanguageMenuOpen && <div className="topbar-language-menu" role="menu" aria-label={translate("language.menu")}><button type="button" role="menuitemradio" aria-checked={!authUser.languageIsCustom} disabled={isSavingLanguage} onClick={() => void selectHeaderLanguage(null)}>{translate("language.browserDefault")} · {browserDefaultLanguage().toUpperCase()}</button>{(["en", "de", "fr", "it"] as const).map((language) => <button key={language} type="button" role="menuitemradio" aria-checked={authUser.languageIsCustom && authUser.language === language} disabled={isSavingLanguage} onClick={() => void selectHeaderLanguage(language)}>{translate(`language.${({ en: "english", de: "german", fr: "french", it: "italian" } as const)[language]}`)}</button>)}</div>}</div><div className="topbar-account"><div className="topbar-avatar" aria-hidden="true">{userInitials}</div><div className="topbar-account-copy"><strong title={authUser.displayName}>{authUser.displayName}</strong><small title={authUser.username}>{authUser.username}</small></div></div><button className="icon-button topbar-sign-out" type="button" aria-label={translate("nav.signOut")} title={translate("nav.signOut")} onClick={() => void signOut()}><LogOut size={16} /></button></div>
        </header>

        <div className={`page-wrap${moduleForPage(page)?.pageClassName ? ` ${moduleForPage(page)?.pageClassName}` : ""}${moduleForPage(page)?.id === "video-steffisburg" && ["Routing", "Names & locks"].includes(activeModuleState) ? " page-wrap-video-routing" : ""}`}>
          {page === "Settings" ? <ModuleTranslationHost translations={mergeModuleTranslationOverrides("core-admin", translationsForModule("core-admin"))} language={activeLanguage}><div className="settings-page"><div className="settings-page-header"><div><span className="eyebrow">PREFERENCES &amp; ACCESS</span><h1 id="server-settings-title">{translate("settings.title")}</h1><p>{translate("settings.subtitle")}</p></div></div><div className="server-admin-tabs" role="tablist" aria-label="Settings sections"><button type="button" role="tab" id="server-tab-overview" aria-selected={serverSettingsTab === "overview"} aria-controls="server-panel-overview" className={serverSettingsTab === "overview" ? "server-admin-tab server-admin-tab-active" : "server-admin-tab"} onClick={() => setServerSettingsTab("overview")}>{translate("settings.tab.overview")}</button><button type="button" role="tab" id="server-tab-personal" aria-selected={serverSettingsTab === "personal"} aria-controls="server-panel-personal" className={serverSettingsTab === "personal" ? "server-admin-tab server-admin-tab-active" : "server-admin-tab"} onClick={() => setServerSettingsTab("personal")}>{translate("settings.tab.personal")}</button>{department.role === "site_admin" && <button type="button" role="tab" id="server-tab-location" aria-selected={serverSettingsTab === "location"} aria-controls="server-panel-location" className={serverSettingsTab === "location" ? "server-admin-tab server-admin-tab-active" : "server-admin-tab"} onClick={() => setServerSettingsTab("location")}>{translate("settings.tab.access")}</button>}<button type="button" role="tab" id="server-tab-switch" aria-selected={serverSettingsTab === "switch"} aria-controls="server-panel-switch" className={serverSettingsTab === "switch" ? "server-admin-tab server-admin-tab-active" : "server-admin-tab"} onClick={() => setServerSettingsTab("switch")}>{translate("settings.tab.switch")}</button>{hasServerPermission("server_manage") && <button type="button" role="tab" id="server-tab-server" aria-selected={serverSettingsTab === "server"} aria-controls="server-panel-server" className={serverSettingsTab === "server" ? "server-admin-tab server-admin-tab-active" : "server-admin-tab"} onClick={() => setServerSettingsTab("server")}>Server</button>}{hasServerPermission("server_manage") && <button type="button" role="tab" id="server-tab-sites" aria-selected={serverSettingsTab === "sites"} aria-controls="server-panel-sites" className={serverSettingsTab === "sites" ? "server-admin-tab server-admin-tab-active" : "server-admin-tab"} onClick={() => { setDepartmentDraft(department); setIsAddingLocation(false); setServerSettingsTab("sites"); }}>{translate("settings.tab.sites")}</button>}{hasServerPermission("server_manage") && <button type="button" role="tab" id="server-tab-users" aria-selected={serverSettingsTab === "users"} aria-controls="server-panel-users" className={serverSettingsTab === "users" ? "server-admin-tab server-admin-tab-active" : "server-admin-tab"} onClick={() => { setServerSettingsTab("users"); void openUserAccess(); }}>{translate("settings.tab.users")}</button>}{(hasServerPermission("server_manage") || department.role === "site_admin") && <button type="button" role="tab" id="server-tab-modules" aria-selected={serverSettingsTab === "modules"} aria-controls="server-panel-modules" className={serverSettingsTab === "modules" ? "server-admin-tab server-admin-tab-active" : "server-admin-tab"} onClick={openModuleManagement}>{translate("settings.tab.modules")}</button>}</div>{serverSettingsTab === "overview" && <div role="tabpanel" id="server-panel-overview" aria-labelledby="server-tab-overview">{authUser.role === "server_admin" && <section className="my-settings-section" aria-labelledby="http-access-mode-title"><div><h3 id="http-access-mode-title">HTTP access behavior</h3><p>Choose how the web app responds when opened over an unencrypted HTTP connection. Redirect requires a configured public HTTPS address.</p>{httpAccessFeedback && <small className="system-notification-feedback" role="status">{httpAccessFeedback}</small>}</div><div className="personal-format-controls"><label className="personal-format-select"><span className="sr-only">HTTP access behavior</span><select value={httpAccessModeDraft} onChange={(event) => { setHttpAccessModeDraft(event.target.value as HttpAccessMode); setHttpAccessFeedback(""); }}><option value="none">Do nothing; HTTPS remains available</option><option value="warning">Show a warning banner at the top</option><option value="redirect" disabled={!httpsOrigin}>Redirect to HTTPS{httpsOrigin ? "" : " (configure HTTPS first)"}</option></select></label><button className="button button-secondary" type="button" onClick={() => void saveHttpAccessMode()} disabled={isHttpAccessSaving || httpAccessModeDraft === httpAccessMode}>{isHttpAccessSaving ? "Saving…" : "Save"}</button></div></section>}<div className="server-admin-panel-heading"><h3>Service status</h3><p>Current connection and database health for this Smart-Church server.</p></div><div className="service-status-grid"><article className="service-status-card"><span className="service-status-indicator service-status-ok" /><div><strong>Web app</strong><small>Running in this browser</small></div><b>Online</b></article><article className="service-status-card"><span className={`service-status-indicator ${serviceStatus?.api === "ok" ? "service-status-ok" : serviceStatus ? "service-status-down" : "service-status-pending"}`} /><div><strong>API</strong><small>Application server</small></div><b>{serviceStatus ? serviceStatus.api === "ok" ? "Online" : "Unavailable" : "Checking…"}</b></article><article className="service-status-card"><span className={`service-status-indicator ${serviceStatus?.database === "ok" ? "service-status-ok" : serviceStatus ? "service-status-down" : "service-status-pending"}`} /><div><strong>Database</strong><small>Account and site data</small></div><b>{serviceStatus ? serviceStatus.database === "ok" ? "Online" : "Unavailable" : "Checking…"}</b></article><article className="service-status-card"><span className="service-status-indicator service-status-pending" /><div><strong>Release / build</strong><small>Release {smartChurchBuildInfo.release}</small></div><b>Build {smartChurchBuildInfo.buildNumber}</b></article></div>{(hasServerPermission("server_view") || hasServerPermission("server_troubleshoot")) && <RuntimeDiagnosticsPanel departmentId={department.id} csrfToken={csrfToken} canRestartWorkers={hasServerPermission("server_troubleshoot")} />}</div>}{serverSettingsTab === "personal" && <div role="tabpanel" id="server-panel-personal" aria-labelledby="server-tab-personal">{hasServerPermission("server_api") && <ApiKeySettings mode="self" refreshCsrfToken={refreshCsrfToken} />}<OwnedServiceUsers /><section className="my-settings-section" aria-labelledby="appearance-title"><div><h3 id="appearance-title">{translate("settings.personal.appearance")}</h3><p>{translate("settings.personal.appearanceHelp")}</p></div><div className="theme-options" role="group" aria-label="Color theme"><button className={`theme-option ${theme === "light" ? "theme-option-active" : ""}`} type="button" aria-pressed={theme === "light"} onClick={() => setTheme("light")}><Sun size={17} />{translate("settings.personal.light")}</button><button className={`theme-option ${theme === "dark" ? "theme-option-active" : ""}`} type="button" aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}><Moon size={17} />{translate("settings.personal.dark")}</button></div></section><section className="my-settings-section" aria-labelledby="date-time-format-title"><div><h3 id="date-time-format-title">{translate("settings.personal.dateTime")}</h3><p>{translate("settings.personal.dateTimeHelp")}</p>{personalPreferenceFeedback && <small className="system-notification-feedback" role="status">{personalPreferenceFeedback}</small>}</div><div className="personal-format-controls"><label className="personal-format-select"><span className="sr-only">Date and time format</span><select value={dateTimeFormatDraft} onChange={(event) => { setDateTimeFormatDraft(event.target.value as AuthenticatedUser["dateTimeFormat"]); setPersonalPreferenceFeedback(""); }}><option value="DD.MM.YYYY HH:MM">DD.MM.YYYY HH:MM</option><option value="DD/MM/YYYY HH:MM">DD/MM/YYYY HH:MM</option><option value="MM/DD/YYYY h:mm AM/PM">MM/DD/YYYY h:mm AM/PM</option><option value="YYYY-MM-DD HH:MM">YYYY-MM-DD HH:MM</option></select></label><small className="date-time-format-preview">{translate("settings.personal.preview")}: {formatUserDate(new Date(), true, dateTimeFormatDraft)}</small><button className="button button-secondary" type="button" disabled={isSavingDateTimeFormat || dateTimeFormatDraft === authUser.dateTimeFormat} onClick={() => void saveDateTimeFormat(dateTimeFormatDraft)}>{isSavingDateTimeFormat ? translate("settings.personal.saving") : translate("settings.personal.saveFormat")}</button></div></section><section className="my-settings-section" aria-labelledby="language-preference-title"><div><h3 id="language-preference-title">{translate("settings.personal.language")}</h3><p>{translate("settings.personal.languageHelp")}</p></div><div className="personal-format-controls"><label className="personal-format-select"><span className="sr-only">{translate("settings.personal.language")}</span><select value={languageDraft} onChange={(event) => { setLanguageDraft(event.target.value as AuthenticatedUser["language"] | "auto"); setPersonalPreferenceFeedback(""); }}><option value="auto">{translate("language.browserDefault")} ({browserDefaultLanguage().toUpperCase()})</option><option value="en">{translate("language.english")}</option><option value="de">{translate("language.german")}</option><option value="fr">{translate("language.french")}</option><option value="it">{translate("language.italian")}</option></select></label><button className="button button-secondary" type="button" disabled={isSavingLanguage || (languageDraft === "auto" ? !authUser.languageIsCustom : authUser.languageIsCustom && languageDraft === authUser.language)} onClick={() => void saveLanguage(languageDraft === "auto" ? null : languageDraft)}>{isSavingLanguage ? translate("settings.personal.saving") : translate("settings.personal.saveLanguage")}</button></div></section><section className="my-settings-section system-notification-settings" aria-labelledby="system-notifications-title"><div><h3 id="system-notifications-title">{translate("settings.personal.notifications")}</h3><p>{translate("settings.personal.notificationsHelp")}</p>{systemNotificationFeedback && <small className="system-notification-feedback" role="status">{systemNotificationFeedback}</small>}</div><label className="system-notification-toggle"><input type="checkbox" checked={systemNotificationsEnabled} onChange={(event) => void updateSystemNotifications(event.target.checked)} /><span>{systemNotificationsEnabled ? translate("settings.personal.on") : translate("settings.personal.off")}</span></label></section><UserSessions onSignedOut={signOut} /><p className="modal-demo-footnote">{translate("settings.personal.localNote")}</p></div>}{serverSettingsTab === "location" && department.role === "site_admin" && <div role="tabpanel" id="server-panel-location" aria-labelledby="server-tab-location"><LocationAccess department={department} csrfToken={csrfToken} onClose={() => setPage("People")} embedded /></div>}{serverSettingsTab === "switch" && <div role="tabpanel" id="server-panel-switch" aria-labelledby="server-tab-switch"><div className="server-site-list" role="group" aria-label="Sites on this server">{departments.map((site) => <button className={`server-site-choice ${site.id === department.id ? "server-site-choice-active" : ""}`} type="button" disabled={site.role === "unassigned"} aria-current={site.id === department.id ? "true" : undefined} key={site.id} onClick={() => { switchDepartment(site.id); setPage("People"); }}><span className="server-settings-icon"><Server size={18} /></span><span className="server-site-details"><strong>{site.location}</strong><small>{site.timeZone}{site.role === "unassigned" ? " · Assign yourself in Users tab first" : ""}</small></span><span className="server-site-state">{site.id === department.id ? "Current site" : site.role === "unassigned" ? "No access" : "Switch"}</span></button>)}{departments.length === 0 && <p className="server-settings-empty">No sites are configured on this server yet.</p>}</div><p className="modal-demo-footnote">Signed in as {authUser.displayName}</p></div>}{serverSettingsTab === "sites" && hasServerPermission("server_manage") && <div role="tabpanel" id="server-panel-sites" aria-labelledby="server-tab-sites"><div className="server-admin-panel-heading"><h3>Manage locations</h3><p>Update the active location or add another location hosted by this server.</p></div>{isAddingLocation ? <form onSubmit={addLocation}><label>Location<input name="location" autoFocus required maxLength={120} placeholder="Enter the location name" /></label><label>Time zone<input name="timeZone" required maxLength={80} defaultValue="Europe/Zurich" placeholder="Europe/Zurich" /></label><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setIsAddingLocation(false)}>Back</button><button className="button button-primary" type="submit" disabled={isDepartmentSaving}>{isDepartmentSaving ? "Adding…" : "Add location"}</button></div></form>
          : <><form onSubmit={saveDepartmentSettings}><label>Location<input autoFocus required maxLength={120} value={departmentDraft.location} onChange={(event) => setDepartmentDraft((current) => ({ ...current, location: event.target.value }))} placeholder="Enter your location" /></label><label>Time zone<input required maxLength={80} value={departmentDraft.timeZone} onChange={(event) => setDepartmentDraft((current) => ({ ...current, timeZone: event.target.value }))} placeholder="Europe/Zurich" /></label><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setPage("People")}>Cancel</button><button className="button button-primary" type="submit" disabled={isDepartmentSaving}>{isDepartmentSaving ? "Saving…" : "Save location"}</button></div></form><button className="button button-secondary location-add-button" type="button" onClick={() => setIsAddingLocation(true)}><Plus size={16} /> Add another location</button></>}
</div>}{serverSettingsTab === "users" && hasServerPermission("server_manage") && <ModuleTranslationHost translations={mergeModuleTranslationOverrides("core-admin", translationsForModule("core-admin"))} language={activeLanguage}><div role="tabpanel" id="server-panel-users" aria-labelledby="server-tab-users"><div className="user-access-layout"><aside className="user-access-list"><button className="button button-secondary user-add-button" type="button" onClick={startNewSiteUser}><Plus size={16} /> Add user</button>{isUsersLoading ? <p className="user-access-empty">Loading accounts…</p> : siteUsers.length === 0 ? <p className="user-access-empty">No local users yet.</p> : siteUsers.map((user) => <button className={`user-access-item ${editingUserId === user.id ? "user-access-item-active" : ""}`} type="button" key={user.id} onClick={() => editSiteUser(user)}><strong data-no-translate>{user.displayName}</strong><small><span data-no-translate>@{user.username}</span> · {user.email ? <span data-no-translate>{user.email}</span> : <span>No email address</span>}</small><span>{user.accountRole === "server_admin" ? "Server Administrator" : "Local user"}{!user.isEnabled ? " · Disabled" : ""} · {user.memberships.length} {user.memberships.length === 1 ? "site" : "sites"}</span></button>)}</aside><form className="user-access-form" onSubmit={saveSiteUser}><div className="user-access-form-heading"><h3>{editingUserId ? "Edit user access" : "Create account"}</h3><p>Assign separate core-area rights at each location. Site administrators inherit all core rights; enabled modules keep their own access levels. Link each site membership to the matching person, including read-only ChurchTools records. Users sign in with their username; email is optional. New accounts must choose a new password at first sign-in.</p></div>{authUser.role === "server_admin" && newAccountRole === "user" && <><ServerPermissionsFieldset permissions={serverPermissionsDraft} onChange={setServerPermissionsDraft} /><label className="global-admin-option"><input type="checkbox" checked={isServiceUserDraft} onChange={(event) => { setIsServiceUserDraft(event.target.checked); if (event.target.checked && !serviceUserOwnerIdDraft) setServiceUserOwnerIdDraft(authUser.id); }} /><span><strong>Service user</strong><small>API-only account. It cannot sign in to the web app and is visible only to Server Administrators or same-site administrators.</small></span></label>{isServiceUserDraft && <label>Owner<select value={serviceUserOwnerIdDraft} onChange={(event) => setServiceUserOwnerIdDraft(event.target.value)} required><option value="">Choose an owner</option>{siteUsers.filter((user) => !user.isServiceUser).map((user) => <option key={user.id} value={user.id}>{user.displayName} (@{user.username})</option>)}</select><small>The owner can manage this service user API key, but cannot change its rights.</small></label>}</>}{editingUser?.isServiceUser && <ApiKeySettings key={editingUser.id} mode="service" userId={editingUser.id} userName={editingUser.displayName} departmentId={department.id} enabled={Boolean(editingUser.apiKeyEnabled)} onEnabledChange={(enabled) => setSiteUsers((users) => users.map((user) => user.id === editingUser.id ? { ...user, apiKeyEnabled: enabled } : user))} />}{editingUser && !editingUser.isServiceUser && editingUser.id !== authUser.id && <section className="password-reset-panel" aria-label="Reset user password"><div className="password-reset-heading"><KeyRound size={15} /><strong>Reset password</strong></div>{!isResettingPassword ? <><p>Set a new password for this user. Their current sessions will be signed out.</p><button className="button button-secondary" type="button" onClick={() => { setResetPassword(generateInitialPassword()); setResetPasswordSaved(false); setIsResettingPassword(true); setUserAccessFeedback(null); }}>Reset password</button></> : <><label>Temporary password<div className="generated-password-row"><input value={resetPassword} readOnly={resetPasswordSaved} onChange={(event) => setResetPassword(event.target.value)} autoComplete="off" minLength={12} maxLength={128} aria-label="Temporary password" />{!resetPasswordSaved && <button className="button button-secondary" type="button" onClick={() => setResetPassword(generateInitialPassword())}>Generate</button>}<button className="button button-secondary generated-copy-button" type="button" onClick={() => void copyResetPassword()}><Copy size={15} />Copy</button></div></label>{!resetPasswordSaved && <label className="global-admin-option"><input type="checkbox" checked disabled /><span><strong>Require password change at next sign-in</strong><small>Always required. The user must choose a new password before using the app.</small></span></label>}<div className="password-reset-actions">{!resetPasswordSaved && <button className="button button-primary" type="button" onClick={() => void resetSiteUserPassword()} disabled={isPasswordResetting || resetPassword.length < 12}><KeyRound size={15} />{isPasswordResetting ? "Resetting…" : "Confirm reset"}</button>}<button className="button button-secondary" type="button" onClick={() => { setIsResettingPassword(false); setResetPassword(""); setResetPasswordSaved(false); }}> {resetPasswordSaved ? "Close" : "Cancel"}</button></div></>}</section>}<label>Full name<input key={`name-${editingUserId ?? "new"}`} name="displayName" defaultValue={editingUser?.displayName ?? ""} required maxLength={100} /></label><label>Username<input key={`username-${editingUserId ?? "new"}`} name="username" defaultValue={editingUser?.username ?? ""} required minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" autoComplete="username" /></label><label>Email address <span className="optional-label">Optional</span><input key={`email-${editingUserId ?? "new"}`} name="email" type="email" defaultValue={editingUser?.email ?? ""} maxLength={254} autoComplete="email" /></label><label className="global-admin-option"><input type="checkbox" checked={isAccountEnabledDraft} onChange={(event) => setIsAccountEnabledDraft(event.target.checked)} /><span><strong>Account enabled</strong><small>Disabled users cannot sign in or use API keys.</small></span></label><label>Administrator note <span className="optional-label">Only visible to administrators</span><textarea key={`admin-note-${editingUserId ?? "new"}`} name="adminNote" defaultValue={editingUser?.adminNote ?? ""} maxLength={2000} rows={3} /></label><label>Birthday <span className="optional-label">Optional · DD:MM:YYYY</span><input key={`birthday-${editingUserId ?? "new"}`} name="birthday" defaultValue={editingUser?.birthday ?? ""} placeholder="DD:MM:YYYY" inputMode="numeric" pattern="\d{2}:\d{2}:\d{4}" maxLength={10} /></label><div className="form-row user-address-row"><label>Street / road <span className="optional-label">Optional</span><input key={`street-${editingUserId ?? "new"}`} name="street" defaultValue={editingUser?.street ?? ""} maxLength={160} autoComplete="street-address" /></label><label>Number<input key={`street-number-${editingUserId ?? "new"}`} name="streetNumber" defaultValue={editingUser?.streetNumber ?? ""} maxLength={24} /></label></div><div className="form-row user-address-row"><label>PLZ / postal code<input key={`postal-code-${editingUserId ?? "new"}`} name="postalCode" defaultValue={editingUser?.postalCode ?? ""} maxLength={20} autoComplete="postal-code" /></label><label>City<input key={`city-${editingUserId ?? "new"}`} name="city" defaultValue={editingUser?.city ?? ""} maxLength={100} autoComplete="address-level2" /></label></div><section className="user-phone-section" aria-labelledby="user-phone-heading"><div className="user-profile-section-heading"><strong id="user-phone-heading">Phone numbers</strong><span className="optional-label">Optional</span></div>{userPhoneNumbers.map((phone, index) => <div className="user-phone-row" key={index}><select aria-label={`Phone number ${index + 1} label`} value={phone.label} onChange={(event) => setUserPhoneNumbers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value as UserPhoneLabel } : item))}><option value="home">Home</option><option value="mobile">Mobile</option><option value="work">Work</option><option value="work_mobile">Work mobile</option></select><input type="tel" aria-label={`Phone number ${index + 1}`} value={phone.number} maxLength={32} placeholder="+41 …" onChange={(event) => setUserPhoneNumbers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, number: event.target.value } : item))} /><button className="icon-button user-phone-remove" type="button" aria-label={`Remove phone number ${index + 1}`} onClick={() => setUserPhoneNumbers((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button></div>)}<button className="button button-secondary user-profile-add-button" type="button" onClick={() => setUserPhoneNumbers((current) => [...current, { label: "mobile", number: "" }])}><Plus size={15} /> Add phone number</button></section><section className="user-phone-section" aria-labelledby="user-relationships-heading"><div className="user-profile-section-heading"><strong id="user-relationships-heading">Relationships</strong><span className="optional-label">Optional</span></div>{userRelationships.map((relationship, index) => <div className="user-relationship-row" key={index}><select aria-label={`Related user ${index + 1}`} value={relationship.relatedUserId} onChange={(event) => setUserRelationships((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, relatedUserId: event.target.value } : item))}><option value="">Choose a user</option>{siteUsers.filter((user) => user.id !== editingUserId && !user.isServiceUser).map((user) => <option data-no-translate key={user.id} value={user.id} disabled={userRelationships.some((item, itemIndex) => itemIndex !== index && item.relatedUserId === user.id)}>{user.displayName} (@{user.username})</option>)}</select><select aria-label={`Relationship type ${index + 1}`} value={relationship.relationship} onChange={(event) => setUserRelationships((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, relationship: event.target.value as UserRelationshipKind } : item))}><option value="spouse">Spouse</option><option value="parent">Parent of</option><option value="child">Child of</option><option value="sibling">Sibling</option><option value="guardian">Guardian of</option><option value="ward">Ward of</option><option value="other">Other</option></select><button className="icon-button user-phone-remove" type="button" aria-label={`Remove relationship ${index + 1}`} onClick={() => setUserRelationships((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button></div>)}<button className="button button-secondary user-profile-add-button" type="button" onClick={() => setUserRelationships((current) => [...current, { relatedUserId: "", relationship: "spouse" }])} disabled={siteUsers.filter((user) => user.id !== editingUserId && !user.isServiceUser).length === 0}><Plus size={15} /> Add relationship</button><small className="user-access-hint">Relationships are reciprocal. For example, marking someone as a parent shows them as your child.</small></section>{!isServiceUserDraft && (!editingUserId || (isPasswordSaved && generatedPassword)) && <label>{isPasswordSaved ? "Initial password (copy it now)" : "Suggested password"}<div className="generated-password-row"><input value={generatedPassword} readOnly={isPasswordSaved} onChange={(event) => setGeneratedPassword(event.target.value)} autoComplete="off" aria-label="Initial password" minLength={12} maxLength={128} />{!isPasswordSaved && <button className="button button-secondary" type="button" onClick={() => setGeneratedPassword(generateInitialPassword())}>Generate</button>}<button className="button button-secondary generated-copy-button" type="button" onClick={() => void copyGeneratedPassword()} aria-label="Copy generated password"><Copy size={15} />Copy</button></div><small className="user-access-hint">{isPasswordSaved ? "It is stored as a hash and cannot be shown again after you close this screen." : "Suggested securely. Edit it or generate another. Use at least 12 characters, then give it to the user directly."}</small></label>}<fieldset className="user-membership-fieldset"><legend>Site memberships</legend>{departments.map((site) => <div className="user-membership-row user-membership-row-expanded" key={site.id}><label className="user-membership-check"><input type="checkbox" checked={Boolean(userMemberships[site.id])} onChange={(event) => setUserMemberships((current) => { const next = { ...current }; if (event.target.checked) next[site.id] = { role: "member", permissions: [], videoPermissions: [], presenterPermissions: [] }; else delete next[site.id]; return next; })} /><span><strong>{site.location}</strong><small>{site.timeZone}</small></span></label>{userMemberships[site.id] && <><select aria-label={`${site.location} role`} value={userMemberships[site.id].role} onChange={(event) => setUserMemberships((current) => ({ ...current, [site.id]: { ...current[site.id], role: event.target.value as "site_admin" | "member" } }))}><option value="member">Member</option><option value="site_admin">Site administrator</option></select><label className="user-membership-person-link"><span>Linked person</span><select aria-label={`Person linked to ${site.location}`} value={userMemberships[site.id].contactId ?? ""} onChange={(event) => setUserMemberships((current) => ({ ...current, [site.id]: { ...current[site.id], contactId: event.target.value || undefined } }))}><option value="">No linked person</option>{peopleOptions.filter((person) => person.departmentId === site.id).map((person) => <option data-no-translate key={person.id} value={person.id}>{person.firstName} {person.lastName}{person.importedFrom === "churchtools" ? " · ChurchTools" : ""}{person.email ? ` · ${person.email}` : ""}</option>)}</select></label><fieldset className="module-rights-fieldset"><legend>Location rights</legend>{userMemberships[site.id].role === "site_admin" ? <small>Site administrators inherit all location rights.</small> : locationPermissionOptions.map(({ value, label, description }) => <label className="module-right-option" key={value}><input type="checkbox" checked={userMemberships[site.id].permissions.includes(value)} onChange={(event) => setUserMemberships((current) => { const member = current[site.id]; const permissions = event.target.checked ? [...new Set([...member.permissions, value])] : member.permissions.filter((item) => item !== value); return { ...current, [site.id]: { ...member, permissions } }; })} /><span><strong>{label}</strong><small>{description}</small></span></label>)}</fieldset>{site.enabledModules?.includes("video-steffisburg") && <fieldset className="module-rights-fieldset"><legend>Video rights</legend>{userMemberships[site.id].role === "site_admin" ? <small>Site administrators inherit all Video rights.</small> : videoPermissionOptions.map(({ value, label, description }) => <label className="module-right-option" key={value}><input type="checkbox" checked={userMemberships[site.id].videoPermissions.includes(value)} onChange={(event) => setUserMemberships((current) => { const member = current[site.id]; const permissions = event.target.checked ? [...new Set([...member.videoPermissions, value])] : member.videoPermissions.filter((item) => item !== value); return { ...current, [site.id]: { ...member, videoPermissions: permissions } }; })} /><span><strong>{label}</strong><small>{description}</small></span></label>)}</fieldset>}{site.enabledModules?.includes("presenter") && <PresenterRightsFieldset permissions={userMemberships[site.id].presenterPermissions} isSiteAdmin={userMemberships[site.id].role === "site_admin"} onChange={(presenterPermissions) => setUserMemberships((current) => ({ ...current, [site.id]: { ...current[site.id], presenterPermissions } }))} />}</>}</div>)}</fieldset>{authUser.role === "server_admin" && <label className="global-admin-option"><input type="checkbox" checked={newAccountRole === "server_admin"} onChange={(event) => { const role = event.target.checked ? "server_admin" : "user"; setNewAccountRole(role); if (role === "server_admin") setIsServiceUserDraft(false); }} /><span><strong>{newAccountRole === "server_admin" ? "Server Administrator access" : "Grant Server Administrator access"}</strong><small>Only server administrators can change this server-wide role. Site data still needs separate memberships.</small></span></label>}{userAccessFeedback && <p className={`user-access-feedback ${userAccessFeedback.isError ? "user-access-feedback-error" : ""}`} role={userAccessFeedback.isError ? "alert" : "status"} aria-live="polite">{userAccessFeedback.message}</p>}<div className="form-actions">{editingUser && <button className="button button-danger" type="button" onClick={() => void deleteSiteUser()} disabled={isUserSaving || isUserDeleting || editingUser.id === authUser.id} title={editingUser.id === authUser.id ? "You cannot delete your own account." : undefined}><Trash2 size={15} />{isUserDeleting ? "Deleting…" : "Delete user"}</button>}<button className="button button-secondary" type="button" onClick={() => setPage("People")}>Close</button><button className="button button-primary" type="submit" disabled={isUserSaving || isUsersLoading || (departments.length === 0 && newAccountRole !== "server_admin")}><Check size={16} />{isUserSaving ? "Saving…" : editingUserId ? "Save access" : "Create user"}</button></div><p className="modal-demo-footnote">Membership changes take effect on the next request.</p></form></div></div></ModuleTranslationHost>}{serverSettingsTab === "server" && hasServerPermission("server_manage") && <div role="tabpanel" id="server-panel-server" aria-labelledby="server-tab-server"><ServerEmailSettings refreshCsrfToken={refreshCsrfToken} departmentId={department.id} departmentName={department.location} /><SelfSignupAdmin refreshCsrfToken={refreshCsrfToken} modules={registeredModules} departmentId={department.id} departmentName={department.location} /></div>}{serverSettingsTab === "modules" && (hasServerPermission("server_manage") || department.role === "site_admin") && <div role="tabpanel" id="server-panel-modules" aria-labelledby="server-tab-modules"><div className="server-admin-panel-heading"><h3>Module management</h3><p>{hasServerPermission("server_manage") ? "Choose which modules are active across this installation. Module settings below apply to the selected site; required modules cannot be disabled." : "Optional modules are activated across the installation by a Server Administrator."}</p></div>{hasServerPermission("server_manage") && <label className="module-site-picker">Site<select value={moduleManagementSiteId} onChange={(event) => changeModuleManagementSite(event.target.value)}>{departments.map((site) => <option data-no-translate key={site.id} value={site.id}>{site.location}</option>)}</select></label>}{departments.length === 0 ? <p className="server-settings-empty">No sites are configured on this server yet.</p> : <><div className="settings-module-list">{registeredModules.filter((module) => hasServerPermission("server_manage") || module.required || moduleDraftIds.includes(module.id)).map((module) => { const required = Boolean(module.required); const locked = required; const checked = locked || moduleDraftIds.includes(module.id); return <article className="settings-module-card" key={module.id}><label className="settings-module-option"><input type="checkbox" checked={checked} disabled={!hasServerPermission("server_manage") || locked} onChange={(event) => setModuleDraftIds((current) => event.target.checked ? [...new Set([...current, module.id])] : current.filter((id) => id !== module.id))} /><span><strong>{moduleTranslation(module.translations, activeLanguage, "name", module.name)}</strong><small>{module.id} · {required ? "Required module" : module.accessLabel ?? (module.enabledByDefault ? "Optional · enabled by default" : "Optional module")}</small></span></label>{module.settings && <button className="settings-module-settings-button" type="button" aria-label={translate("settings.openModuleSettings").replace("{name}", moduleTranslation(module.translations, activeLanguage, "name", module.name))} title={translate("settings.openModuleSettings").replace("{name}", moduleTranslation(module.translations, activeLanguage, "name", module.name))} onClick={() => setSelectedModuleSettingsId(module.id)}><Settings2 size={16} /></button>}</article>; })}</div>{hasServerPermission("server_manage") && <div className="form-actions"><button className="button button-primary" type="button" onClick={() => void saveModuleManagement()} disabled={isModuleSaving}><Check size={16} />{isModuleSaving ? "Saving…" : "Save modules"}</button></div>}{moduleManagementFeedback && <p className="user-access-feedback" role="status">{moduleManagementFeedback}</p>}{selectedModuleSettings && <div className="module-settings-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedModuleSettingsId(""); }}><section className="module-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="selected-module-settings-title"><header className="module-settings-dialog-header"><div><ModuleIconHost module={selectedModuleSettings} /><span><h3 id="selected-module-settings-title">{moduleTranslation(selectedModuleSettings.translations, activeLanguage, "name", selectedModuleSettings.name)} settings</h3><small>{selectedModuleSettings.id} · {departments.find((site) => site.id === moduleManagementSiteId)?.location ?? "Select a site"}</small></span></div><button className="icon-button" type="button" aria-label="Close module settings" onClick={() => setSelectedModuleSettingsId("")}><X size={17} /></button></header><div className="module-settings-dialog-content"><ModuleSettingsHost module={selectedModuleSettings} context={{ language: activeLanguage, departmentId: moduleManagementSiteId, csrfToken, departments }} /></div></section></div>}</>}</div>}</div></ModuleTranslationHost> : moduleForPage(page) ? <ModuleHost module={moduleForPage(page)!} context={moduleContext} /> : page === "Overview" ? <Overview departmentId={department.id} departmentLocation={department.location} timeZone={department.timeZone} contacts={contacts} onNavigate={setPage} /> : page === "Groups" ? <Groups departmentId={department.id} contacts={contacts} canManage={canManageGroups} /> : page === "Resources" ? <BookableResources departmentId={department.id} userId={authUser.id} canManage={canManageResources} /> : page === "Services & events" ? <ServicesEvents departmentId={department.id} departmentLocation={department.location} departmentTimeZone={department.timeZone} contacts={contacts} canManage={canManageEvents} onNotice={(message) => setNotice(translateModuleMessage("core-events", activeLanguage, message))} /> : <ModuleTranslationHost translations={mergeModuleTranslationOverrides("core-people", translationsForModule("core-people"))} language={activeLanguage}><>
          <input ref={contactImportInput} className="sr-only" type="file" accept=".csv,text/csv" onChange={(event) => void importContactsCsv(event.currentTarget.files?.[0])} />
          <div className={`demo-notice ${loadError ? "demo-notice-error" : ""}`}><span className="demo-dot" />{loadError ? `Workspace unavailable · ${loadError}` : `People are saved for ${department.location}`}</div>

          <section className="page-heading">
            <div>
              <div className="eyebrow">YOUR COMMUNITY</div>
              <h1>People</h1>
              <p className="page-subtitle">A thoughtful place to care for the people in your church.</p>
            </div>
            {canManagePeople && <button className="button button-primary" type="button" onClick={() => { setEditingContact(null); setIsAddOpen(true); }}><Plus size={18} /> Add a person</button>}
          </section>

          <section className="stat-grid" aria-label="People summary">
            <article className="stat-card"><div className="stat-icon stat-icon-green"><UsersRound size={19} /></div><div className="stat-content"><span>Total people</span><strong>{contacts.length}</strong><small>At this location</small></div></article>
            <article className="stat-card"><div className="stat-icon stat-icon-blue"><Church size={18} /></div><div className="stat-content"><span>Members</span><strong>{memberCount}</strong><small>At this location</small></div></article>
            <article className="stat-card"><div className="stat-icon stat-icon-amber"><ContactRound size={19} /></div><div className="stat-content"><span>Visitors</span><strong>{visitorCount}</strong><small>At this location</small></div></article>
            {canManagePeople && <button className="stat-card stat-card-action" type="button" onClick={() => contactImportInput.current?.click()} disabled={isSaving}><div className="import-icon"><Plus size={19} /></div><span className="stat-content"><span>Growing together</span><strong className="stat-action-title">Import people</strong><small>Upload a CSV file</small></span><span className="card-arrow">↗</span></button>}
          </section>

          <section className="directory-card">
            <div className="directory-heading"><div><h2>People directory</h2><p>Keep your community close and connected.</p></div></div>
            <div className="directory-toolbar"><div className="search-field"><Search size={17} /><input aria-label="Search people" placeholder="Search by name, email, or phone..." value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="filter-tabs" role="tablist" aria-label="Filter by status"><button className={statusFilter === "all" ? "filter-tab filter-tab-active" : "filter-tab"} type="button" role="tab" aria-selected={statusFilter === "all"} onClick={() => setStatusFilter("all")}>All <span>{contacts.length}</span></button><button className={statusFilter === "member" ? "filter-tab filter-tab-active" : "filter-tab"} type="button" role="tab" aria-selected={statusFilter === "member"} onClick={() => setStatusFilter("member")}>Members <span>{contacts.filter((contact) => contact.status === "member").length}</span></button><button className={statusFilter === "visitor" ? "filter-tab filter-tab-active" : "filter-tab"} type="button" role="tab" aria-selected={statusFilter === "visitor"} onClick={() => setStatusFilter("visitor")}>Visitors <span>{contacts.filter((contact) => contact.status === "visitor").length}</span></button></div><button className="icon-button sort-button" type="button" aria-label={`Sort people ${contactSort === "asc" ? "Z to A" : "A to Z"}`} title={`Sort ${contactSort === "asc" ? "Z to A" : "A to Z"}`} onClick={() => setContactSort((current) => current === "asc" ? "desc" : "asc")}><SlidersHorizontal size={17} /></button></div>

            <div className="table-scroll"><table className="people-table"><thead><tr><th>PERSON</th><th>STATUS</th><th>EMAIL ADDRESS</th><th>PHONE</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
              {visibleContacts.map((contact, index) => <tr key={contact.id}><td><div className="person-cell"><div className={`person-avatar avatar-${index % 6}`}>{initials(contact)}</div><div><strong data-no-translate>{contact.firstName} {contact.lastName}</strong>{contact.importedFrom === "churchtools" ? <small>ChurchTools · read-only</small> : contact.importedFrom === "elvanto" ? <small>Elvanto · read-only</small> : <small data-no-translate>{department.location}</small>}{(contact.elvantoProfile || contact.churchtoolsProfile) && <details><summary>Imported profile</summary><dl>{Object.entries(contact.churchtoolsProfile ?? contact.elvantoProfile ?? {}).map(([key, value]) => <div key={key}><dt>{importedProfileLabels[key] ?? key}</dt><dd data-no-translate>{key === "customFields" && Array.isArray(value) ? value.map((field) => { const item = field as { name?: string; value?: unknown }; return `${item.name ?? "Custom field"}: ${importedProfileValue(item.value)}`; }).join(" · ") : importedProfileValue(value)}</dd></div>)}</dl></details>}{contact.churchtoolsRelationships?.length ? <details className="person-related-people"><summary>Related people</summary><ul>{contact.churchtoolsRelationships.map((relationship, relationIndex) => <li key={`${relationship.relatedContactId}-${relationship.sourceRelationshipId ?? relationIndex}`}>{relationship.relationshipName ? `${relationship.relationshipName}: ` : ""}<span data-no-translate>{relationship.relatedFirstName} {relationship.relatedLastName}</span>{relationship.degreeOfRelationship ? ` · ${relationship.degreeOfRelationship}` : ""}</li>)}</ul></details> : null}</div></div></td><td><span className={`status-pill ${contact.status === "member" ? "status-member" : "status-visitor"}`}><span />{contact.status === "member" ? "Member" : "Visitor"}</span></td><td className="muted-cell" data-no-translate>{contact.email || "—"}</td><td className="muted-cell" data-no-translate>{contact.phone || "—"}</td><td>{canManagePeople && !contact.importedFrom && <div className="event-actions"><button className="event-action" type="button" aria-label={`Edit ${contact.firstName} ${contact.lastName}`} onClick={() => { setEditingContact(contact); setIsAddOpen(true); }}><Pencil size={14} /></button><button className="event-action event-delete-action" type="button" aria-label={`Delete ${contact.firstName} ${contact.lastName}`} onClick={() => void deleteContact(contact)}><Trash2 size={14} /></button></div>}</td></tr>)}
              {visibleContacts.length === 0 && <tr><td colSpan={5} className="empty-state">{isLoading ? "Loading people…" : loadError ? "People could not be loaded." : "No people yet. Add someone to get started."}</td></tr>}
            </tbody></table></div>
            <footer className="table-footer"><span>Showing <strong>{visibleContacts.length}</strong> of <strong>{contacts.length}</strong> people</span></footer>
          </section>

          <footer className="page-footer"><span>Made for the moments that matter.</span><span>© 2026 Smart Church</span></footer>
          </></ModuleTranslationHost>}
        </div>
      </main>

      {notice && <div className="toast" role="status"><Check size={17} />{translateKnownModuleUiOverrideMessage(activeLanguage, translateKnownModuleMessage(activeLanguage, notice))}<button className="toast-close" type="button" aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={15} /></button></div>}

      {!(systemNotificationsEnabled && systemNotificationPermission === "granted") && chatNotifications.length > 0 && <section className="chat-notification-stack" aria-label="New chat messages" aria-live="polite">{chatNotifications.map((notification) => <article className="chat-notification" key={notification.id}>
        <button className="chat-notification-open" type="button" onClick={() => { setRequestedChatConversationId(notification.conversationId); setPage(modulePage("chat")); setChatNotifications((current) => current.filter((item) => item.id !== notification.id)); }}>
          <span className="chat-notification-icon"><MessageCircle size={17} /></span>
          <span className="chat-notification-copy"><strong>{notification.author}</strong><span>{notification.body}</span></span>
        </button>
        <button className="chat-notification-dismiss" type="button" aria-label="Dismiss new message notification" onClick={() => setChatNotifications((current) => current.filter((item) => item.id !== notification.id))}><X size={14} /></button>
      </article>)}</section>}







      {isAddOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && (setIsAddOpen(false), setEditingContact(null))}><ModuleTranslationHost translations={mergeModuleTranslationOverrides("core-people", translationsForModule("core-people"))} language={activeLanguage}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="add-person-title"><div className="modal-heading"><div><span className="eyebrow">PEOPLE DIRECTORY</span><h2 id="add-person-title">{editingContact ? "Edit person" : "Add a person"}</h2><p>{editingContact ? "Update this person’s contact details." : "Start with the details you have. You can add more later."}</p></div><button className="icon-button" type="button" aria-label="Close dialog" onClick={() => { setIsAddOpen(false); setEditingContact(null); }}><X size={19} /></button></div><form key={editingContact?.id ?? "new-contact"} onSubmit={addContact}><div className="form-row"><label>First name<input name="firstName" autoFocus autoComplete="given-name" required maxLength={80} defaultValue={editingContact?.firstName ?? ""} /></label><label>Last name<input name="lastName" autoComplete="family-name" required maxLength={80} defaultValue={editingContact?.lastName ?? ""} /></label></div><label>Email address <span className="optional-label">Optional</span><input type="email" name="email" autoComplete="email" maxLength={254} placeholder="name@example.com" defaultValue={editingContact?.email ?? ""} /></label><label>Phone number <span className="optional-label">Optional</span><input type="tel" name="phone" autoComplete="tel" maxLength={40} placeholder="+41 00 000 00 00" defaultValue={editingContact?.phone ?? ""} /></label><label>Status<select name="status" defaultValue={editingContact?.status ?? "member"}><option value="member">Member</option><option value="visitor">Visitor</option></select></label><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => { setIsAddOpen(false); setEditingContact(null); }}>Cancel</button><button className="button button-primary" type="submit" disabled={isSaving}>{editingContact ? <Check size={17} /> : <Plus size={17} />} {isSaving ? "Saving…" : editingContact ? "Save changes" : "Add person"}</button></div></form></section></ModuleTranslationHost></div>}

      {isBrandingOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setIsBrandingOpen(false)}><section className="modal branding-modal" role="dialog" aria-modal="true" aria-labelledby="branding-title"><div className="modal-heading"><div><span className="eyebrow">SITE ADMINISTRATION</span><h2 id="branding-title">Site logo</h2><p>Choose the logo shown at the top of the sidebar.</p></div><button className="icon-button" type="button" aria-label="Close dialog" onClick={() => setIsBrandingOpen(false)}><X size={19} /></button></div><div className="branding-preview"><img src={brandingDraft || defaultLogoUrl} alt="Logo preview" onError={(event) => { event.currentTarget.style.display = "none"; }} /></div><label className="branding-upload">Upload a logo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => selectBrandingLogo(event.currentTarget.files?.[0])} /></label><p className="branding-help">PNG, JPEG, or WebP · up to 2 MB. The GfC logo is used by default.</p><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setBrandingDraft(null)}>Use GfC default</button><button className="button button-secondary" type="button" onClick={() => setIsBrandingOpen(false)}>Cancel</button><button className="button button-primary" type="button" disabled={isBrandingSaving} onClick={saveBranding}>{isBrandingSaving ? "Saving…" : "Save logo"}</button></div><p className="modal-demo-footnote">Your signed-in account can update the logo for this installation.</p></section></div>}

    </div>
  );
}

function App() {
  const registrationRoute = window.location.pathname.match(/^\/register\/([0-9a-f-]{36})\/?$/i);
  const groupSignupRoute = window.location.pathname.match(/^\/join-group\/([0-9a-f-]{36})\/?$/i);
  if (registrationRoute) return <PublicEventRegistration token={registrationRoute[1]} />;
  return groupSignupRoute ? <PublicGroupSignup token={groupSignupRoute[1]} /> : <WorkspaceApp />;
}

export { App };
