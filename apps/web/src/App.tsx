import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Bell,
  BookOpen,
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
  LogOut,
  Menu,
  MonitorPlay,
  Moon,
  Plus,
  Search,
  Server,
  Settings2,
  SlidersHorizontal,
  Sun,
  Trash2,
  UsersRound,
  X,
  Video,
} from "lucide-react";
import type { AuthenticatedUser, AuthStatus, Contact, ContactStatus, CreateSiteUser, DepartmentProfile, PresenterPermission, SiteUser, UserPhoneLabel, UserPhoneNumber, UserRelationshipInput, UserRelationshipKind, VideoPermission } from "@smart-church/contracts";
import { Authentication, PasswordChangeRequired } from "./Authentication";
import { ServicesEvents } from "./ServicesEvents";
import { VideoModule } from "./modules/video/VideoModule";
import { PresenterWorkspace } from "./modules/video/PresenterWorkspace";

const navigation = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "People", icon: UsersRound },
  { label: "Services & events", icon: CalendarDays },
  { label: "Video & streaming", icon: Video },
  { label: "Presenter", icon: MonitorPlay },
  { label: "Groups", icon: ContactRound },
  { label: "Resources", icon: BookOpen },
];
const videoPermissionOptions: Array<{ value: VideoPermission; label: string; description: string }> = [
  { value: "video_basic", label: "Video Basic", description: "View streaming, routing, status and history." },
  { value: "streaming_operator", label: "Streaming Operator", description: "Start and stop streams; trigger Shelly power cycles." },
  { value: "stream_admin", label: "Stream Admin", description: "Change encoder settings and streaming profiles." },
  { value: "routing_user", label: "Routing User", description: "Change routes and manage routing presets." },
  { value: "routing_admin", label: "Routing Admin", description: "Lock routes and rename sources and destinations." },
];
const presenterPermissionOptions: Array<{ value: PresenterPermission; label: string; description: string }> = [
  { value: "editor", label: "Editor", description: "Edit slides; intended for users outside the technical team." },
  { value: "operator", label: "Operator", description: "Edit slides and present them." },
  { value: "admin", label: "Admin", description: "Edit and present, and change layouts." },
];

const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
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

type WorkspacePage = "People" | "Services & events" | "Video & streaming" | "Presenter";
const workspacePageHashes: Record<WorkspacePage, string> = {
  People: "#people",
  "Services & events": "#services-events",
  "Video & streaming": "#video-streaming",
  Presenter: "#presenter",
};
function workspacePageFromHash(hash: string): WorkspacePage | null {
  const entry = Object.entries(workspacePageHashes).find(([, route]) => route === hash);
  return (entry?.[0] as WorkspacePage | undefined) ?? null;
}
function savedWorkspacePage(): WorkspacePage {
  try {
    const saved = localStorage.getItem("smart-church-page");
    if (saved === "Services & events" || saved === "Video & streaming" || saved === "Presenter") return saved;
  } catch { /* Use the default page when local storage is unavailable. */ }
  return "People";
}

function initials(contact: Contact) {
  return `${contact.firstName[0] ?? ""}${contact.lastName[0] ?? ""}`.toUpperCase();
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

function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      return localStorage.getItem("smart-church-theme") === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ContactStatus>("all");
  const [page, setPage] = useState<WorkspacePage>(() => workspacePageFromHash(window.location.hash) ?? savedWorkspacePage());
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoUnavailable, setLogoUnavailable] = useState(false);
  const [isBrandingOpen, setIsBrandingOpen] = useState(false);
  const [brandingDraft, setBrandingDraft] = useState<string | null>(null);
  const [isBrandingSaving, setIsBrandingSaving] = useState(false);
  const [isServerSettingsOpen, setIsServerSettingsOpen] = useState(false);
  const [isMySettingsOpen, setIsMySettingsOpen] = useState(false);
  const [department, setDepartment] = useState<DepartmentProfile>(defaultDepartment);
  const [departments, setDepartments] = useState<DepartmentProfile[]>([]);
  const [departmentDraft, setDepartmentDraft] = useState(defaultDepartment);
  const [isDepartmentOpen, setIsDepartmentOpen] = useState(false);
  const [isAddingLocation, setIsAddingLocation] = useState(false);
  const [isDepartmentSaving, setIsDepartmentSaving] = useState(false);
  const [isUserAccessOpen, setIsUserAccessOpen] = useState(false);
  const [siteUsers, setSiteUsers] = useState<SiteUser[]>([]);
  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [isUserSaving, setIsUserSaving] = useState(false);
  const [isUserDeleting, setIsUserDeleting] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordSaved, setResetPasswordSaved] = useState(false);
  const [forcePasswordChange, setForcePasswordChange] = useState(true);
  const [isPasswordResetting, setIsPasswordResetting] = useState(false);
  const [userAccessFeedback, setUserAccessFeedback] = useState<{ message: string; isError: boolean } | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userMemberships, setUserMemberships] = useState<Record<string, { role: "site_admin" | "member"; videoPermissions: VideoPermission[]; presenterPermissions: PresenterPermission[] }>>({});
  const [userPhoneNumbers, setUserPhoneNumbers] = useState<UserPhoneNumber[]>([]);
  const [userRelationships, setUserRelationships] = useState<UserRelationshipInput[]>([]);
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [isPasswordSaved, setIsPasswordSaved] = useState(false);
  const [newAccountRole, setNewAccountRole] = useState<"server_admin" | "user">("user");
  const [authLoading, setAuthLoading] = useState(true);
  const [authUser, setAuthUser] = useState<AuthenticatedUser | null>(null);
  const [csrfToken, setCsrfToken] = useState("");
  const [setupRequired, setSetupRequired] = useState(false);
  const [authUnavailableMessage, setAuthUnavailableMessage] = useState("");

  const logoSrc = logoDataUrl || defaultLogoUrl;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("smart-church-theme", theme);
    } catch {
      // The theme remains usable when storage is disabled.
    }
  }, [theme]);

  useEffect(() => {
    try { localStorage.setItem("smart-church-page", page); } catch { /* Keep the current page for this session. */ }
  }, [page]);

  useEffect(() => {
    const hash = workspacePageHashes[page];
    if (window.location.hash !== hash) window.location.hash = hash;
  }, [page]);

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
    const moduleAccess = department.role === "site_admin";
    const videoAvailable = (department.enabledModules ?? []).includes("video") && (moduleAccess || (department.videoPermissions ?? []).length > 0);
    const presenterAvailable = (department.enabledModules ?? []).includes("presenter") && (moduleAccess || (department.presenterPermissions ?? []).length > 0);
    if (authUser && department.id && departments.length > 0 && page === "Video & streaming" && !videoAvailable) setPage("People");
    if (authUser && department.id && departments.length > 0 && page === "Presenter" && !presenterAvailable) setPage("People");
  }, [authUser, department.id, department.role, department.videoPermissions, department.presenterPermissions, department.enabledModules, departments.length, page]);

  useEffect(() => {
    fetch("/api/auth/status")
      .then(async (response) => {
        const result = await response.json() as AuthStatus | { error?: string };
        if (!response.ok || !("authenticated" in result)) throw new Error("error" in result ? result.error ?? "Could not check sign-in status." : "Could not check sign-in status.");
        setSetupRequired(result.setupRequired);
        setAuthUser(result.user ?? null);
        setCsrfToken(result.csrfToken ?? "");
      })
      .catch((error: unknown) => setAuthUnavailableMessage(error instanceof Error ? error.message : "The account service is unavailable."))
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (!authUser) return;
    if (!department.id) return;
    const controller = new AbortController();
    setIsLoading(true);
    setContacts([]);
    setLoadError("");
    departmentFetch("/api/contacts", { signal: controller.signal }, department.id)
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not load contacts.");
        setContacts(result as Contact[]);
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Could not load contacts."); })
      .finally(() => { if (!controller.signal.aborted) setIsLoading(false); });
    return () => controller.abort();
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
        const accessibleDepartments = availableDepartments.filter((item) => item.role !== "unassigned");
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
    });
  }, [contacts, query, statusFilter]);

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
      const response = await departmentFetch("/api/contacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }, department.id);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save this person.");
      const contact = result as Contact;
      setContacts((current) => [contact, ...current]);
      setLoadError("");
      setIsAddOpen(false);
      form.reset();
      setNotice(`${contact.firstName} ${contact.lastName} was saved.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save this person.");
    } finally {
      setIsSaving(false);
    }
    window.setTimeout(() => setNotice(""), 4000);
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

  function openDepartmentSettings() {
    setDepartmentDraft(department);
    setIsAddingLocation(false);
    setIsDepartmentOpen(true);
  }

  function switchDepartment(id: string) {
    const selected = departments.find((item) => item.id === id);
    if (!selected || selected.role === "unassigned") return;
    setDepartment(selected);
    setDepartmentDraft(selected);
    setContacts([]);
    setPage("People");
    setQuery("");
    setStatusFilter("all");
    setIsAddOpen(false);
    setIsDepartmentOpen(false);
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
      setIsDepartmentOpen(false);
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
      setIsDepartmentOpen(false);
      setIsAddingLocation(false);
      setNotice(`${result.location} was added.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not add this location.");
    } finally {
      setIsDepartmentSaving(false);
    }
  }

  async function openUserAccess() {
    setIsUserAccessOpen(true);
    setIsUsersLoading(true);
    try {
      const response = await fetch("/api/users");
      const result = await response.json() as SiteUser[] | { error?: string };
      if (!response.ok || !Array.isArray(result)) throw new Error(!Array.isArray(result) ? result.error ?? "Could not load users." : "Could not load users.");
      setSiteUsers(result);
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
    setUserMemberships(Object.fromEntries(user.memberships.map(({ departmentId, role, videoPermissions, presenterPermissions }) => [departmentId, { role, videoPermissions: videoPermissions ?? [], presenterPermissions: presenterPermissions ?? [] }])));
    setUserPhoneNumbers(user.phoneNumbers ?? []);
    setUserRelationships((user.relationships ?? []).map(({ relatedUserId, relationship }) => ({ relatedUserId, relationship })));
    setGeneratedPassword("");
    setIsPasswordSaved(false);
    setIsResettingPassword(false);
    setResetPassword("");
    setResetPasswordSaved(false);
    setForcePasswordChange(true);
  }

  function startNewSiteUser() {
    setUserAccessFeedback(null);
    setEditingUserId(null);
    setNewAccountRole("user");
    setUserMemberships(department.id ? { [department.id]: { role: "member", videoPermissions: [], presenterPermissions: [] } } : {});
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
      ...(!editingUserId ? { password: generatedPassword, accountRole: newAccountRole } : {}),
    } as CreateSiteUser;
    if (!editingUserId && generatedPassword.length < 6) {
      setUserAccessFeedback({ message: "Generate a password with at least six characters.", isError: true });
      setNotice("Generate a password with at least six characters.");
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
      if (editingUserId === authUser?.id) {
        const roles = new Map(memberships.map((membership) => [membership.departmentId, membership.role]));
        setDepartments((current) => current.map((site) => ({ ...site, role: roles.get(site.id) ?? "unassigned" })));
        const nextSite = departments.find((site) => roles.has(site.id));
        if (nextSite) {
          setDepartment({ ...nextSite, role: roles.get(nextSite.id)! });
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
    const confirmed = window.confirm(`Delete ${editingUser.displayName} (@${editingUser.username})? Their account, site access, and active sessions will be removed.`);
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
    if (!editingUser || editingUser.id === authUser?.id || resetPassword.length < 6) return;
    if (!window.confirm(`Reset the password for ${editingUser.displayName}? Their active sessions will end.`)) return;
    setUserAccessFeedback(null);
    setIsPasswordResetting(true);
    try {
      const response = await fetch(`/api/users/${editingUser.id}/reset-password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: resetPassword, mustChangePassword: forcePasswordChange }) });
      const result = await response.json() as { id?: string; error?: string };
      if (!response.ok || result.id !== editingUser.id) throw new Error(result.error ?? "Could not reset this password.");
      setResetPasswordSaved(true);
      setUserAccessFeedback({ message: forcePasswordChange ? "Password reset. The user must choose a new password at their next sign-in." : "Password reset. The user can sign in with this password.", isError: false });
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
      setIsDepartmentOpen(false);
      setIsUserAccessOpen(false);
    }
  }

  const memberCount = contacts.filter((contact) => contact.status === "member").length;
  const visitorCount = contacts.filter((contact) => contact.status === "visitor").length;

  if (authLoading) return <main className="auth-page"><section className="auth-card auth-loading" role="status"><span className="eyebrow">GFC WORKSPACE</span><p>Checking your sign-in…</p></section></main>;
  if (!authUser) return <Authentication setupRequired={setupRequired} unavailableMessage={authUnavailableMessage} onAuthenticated={(user) => { setAuthUnavailableMessage(""); setSetupRequired(false); setAuthUser(user); void fetch("/api/auth/status").then((response) => response.json()).then((result: AuthStatus) => setCsrfToken(result.csrfToken ?? "")).catch(() => setCsrfToken("")); }} />;
  if (authUser.mustChangePassword) return <PasswordChangeRequired onChanged={setAuthUser} />;

  const userInitials = authUser.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || authUser.username[0]?.toUpperCase() || "U";
  const canManageSite = department.role === "site_admin";
  const videoModuleEnabled = (department.enabledModules ?? []).includes("video");
  const videoPermissions = new Set(department.videoPermissions ?? []);
  const canViewVideo = videoModuleEnabled && (canManageSite || videoPermissions.size > 0);
  const presenterModuleEnabled = (department.enabledModules ?? []).includes("presenter");
  const presenterPermissions = new Set(department.presenterPermissions ?? []);
  const canViewPresenter = presenterModuleEnabled && (canManageSite || presenterPermissions.size > 0);
  const presenterCapabilities = {
    canEdit: canManageSite || presenterPermissions.has("editor") || presenterPermissions.has("operator") || presenterPermissions.has("admin"),
    canPresent: canManageSite || presenterPermissions.has("operator") || presenterPermissions.has("admin"),
    canManageLayouts: canManageSite || presenterPermissions.has("admin"),
  };
  const videoCapabilities = {
    canOperateStreaming: canManageSite || videoPermissions.has("streaming_operator") || videoPermissions.has("stream_admin"),
    canManageEncoders: canManageSite || videoPermissions.has("stream_admin"),
    canManageRouting: canManageSite || videoPermissions.has("routing_user") || videoPermissions.has("routing_admin"),
    canAdminRouting: canManageSite || videoPermissions.has("routing_admin"),
  };
  const renderNavigationItem = ({ label, icon: Icon }: typeof navigation[number]) => {
    const isAvailablePage = label === "People" || label === "Services & events" || label === "Video & streaming" || label === "Presenter";
    const active = page === label;
    return <button className={`nav-item ${active ? "nav-item-active" : ""}`} type="button" key={label} onClick={() => {
      if (isAvailablePage) {
        setPage(label as WorkspacePage);
        setMenuOpen(false);
      } else setNotice(`${label} will be added in a later step.`);
    }}>
      <Icon size={18} strokeWidth={1.8} /><span>{label}</span>{active && <span className="nav-indicator" />}
    </button>;
  };
  const editingUser = siteUsers.find((user) => user.id === editingUserId) ?? null;

  return (
    <div className="app-frame">
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="brand-header">
          <a className="brand" href="#people" aria-label="Church home">
            {logoUnavailable ? <><span className="brand-mark"><Church size={21} strokeWidth={1.8} /></span><span className="brand-name">smart<span>church</span></span></> : <img className="brand-custom-logo" src={logoSrc} alt="GfC logo" onError={() => setLogoUnavailable(true)} />}
          </a>
          <button className="brand-location" type="button" aria-label={`Switch site. Current site: ${department.location}`} onClick={() => setIsServerSettingsOpen(true)}><span>{department.location}</span><ChevronDown size={15} aria-hidden="true" /></button>
        </div>

        <nav className="main-nav" aria-label="Main navigation">
          <div className="nav-label nav-section-label">Core</div>
          {navigation.filter(({ label }) => label !== "Video & streaming" && label !== "Presenter").map(renderNavigationItem)}
          {(canViewVideo || canViewPresenter) && <><div className="nav-label nav-section-label nav-module-label">Modules</div>{canViewVideo && navigation.filter(({ label }) => label === "Video & streaming").map(renderNavigationItem)}{canViewPresenter && navigation.filter(({ label }) => label === "Presenter").map(renderNavigationItem)}</>}
        </nav>

        <div className="sidebar-bottom">
          <button className="nav-item" type="button" onClick={() => setNotice("Notifications will be added in a later step.")}><Bell size={18} strokeWidth={1.8} /><span>Notifications</span><span className="notification-dot" /></button>
          <button className="nav-item" type="button" onClick={() => setIsMySettingsOpen(true)}><Settings2 size={18} strokeWidth={1.8} /><span>My Settings</span></button>
          <button className="nav-item" type="button" onClick={() => setIsServerSettingsOpen(true)}><Server size={18} strokeWidth={1.8} /><span>Server settings</span></button>
          {authUser.role === "server_admin" && <button className="nav-item" type="button" onClick={openDepartmentSettings}><Building2 size={18} strokeWidth={1.8} /><span>Manage sites</span></button>}
          {authUser.role === "server_admin" && <button className="nav-item" type="button" onClick={() => { setMenuOpen(false); startNewSiteUser(); void openUserAccess(); }}><UsersRound size={18} strokeWidth={1.8} /><span>User access</span></button>}
          <button className="nav-item" type="button" onClick={() => setNotice("Help will be added in a later step.")}><CircleHelp size={18} strokeWidth={1.8} /><span>Help & support</span></button>
          <div className="profile-card">
            <div className="profile-avatar">{userInitials}</div>
            <div className="profile-details"><strong>{authUser.displayName}</strong><small>{authUser.role === "server_admin" ? "Server Administrator" : canManageSite ? "Site Administrator" : "Site Member"}</small></div>
            <button className="icon-button profile-menu" type="button" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      {menuOpen && <button className="mobile-scrim" type="button" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}

      <main className="main-content">
        <header className="topbar">
          <button className="icon-button mobile-menu-button" type="button" aria-label="Open menu" onClick={() => setMenuOpen(true)}><Menu size={21} /></button>
          <div className="breadcrumbs"><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>{page}</strong></div>
          <div className="topbar-actions"><span className="date-label">{today}</span><button className="icon-button theme-toggle" type="button" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} aria-pressed={theme === "dark"} title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}</button><button className="icon-button topbar-bell" aria-label="Notifications" type="button" onClick={() => setNotice("You’re all caught up.")}><Bell size={19} /></button><div className="topbar-avatar">{userInitials}</div></div>
        </header>

        <div className={`page-wrap${page === "Video & streaming" ? " page-wrap-video" : page === "Presenter" ? " page-wrap-video page-wrap-presenter" : ""}`}>
          {page === "Services & events" ? <ServicesEvents departmentId={department.id} departmentLocation={department.location} departmentTimeZone={department.timeZone} canManage={canManageSite} onNotice={setNotice} /> : page === "Video & streaming" ? <VideoModule departmentId={department.id} csrfToken={csrfToken} capabilities={videoCapabilities} /> : page === "Presenter" ? <PresenterWorkspace capabilities={presenterCapabilities} /> : <>
          <div className={`demo-notice ${loadError ? "demo-notice-error" : ""}`}><span className="demo-dot" />{loadError ? `Workspace unavailable · ${loadError}` : `People are saved for ${department.location}`}</div>

          <section className="page-heading">
            <div>
              <div className="eyebrow">YOUR COMMUNITY</div>
              <h1>People</h1>
              <p className="page-subtitle">A thoughtful place to care for the people in your church.</p>
            </div>
            {canManageSite && <button className="button button-primary" type="button" onClick={() => setIsAddOpen(true)}><Plus size={18} /> Add a person</button>}
          </section>

          <section className="stat-grid" aria-label="People summary">
            <article className="stat-card"><div className="stat-icon stat-icon-green"><UsersRound size={19} /></div><div className="stat-content"><span>Total people</span><strong>{contacts.length}</strong><small>At this location</small></div></article>
            <article className="stat-card"><div className="stat-icon stat-icon-blue"><Church size={18} /></div><div className="stat-content"><span>Members</span><strong>{memberCount}</strong><small>At this location</small></div></article>
            <article className="stat-card"><div className="stat-icon stat-icon-amber"><ContactRound size={19} /></div><div className="stat-content"><span>Visitors</span><strong>{visitorCount}</strong><small>At this location</small></div></article>
            <article className="stat-card stat-card-action" onClick={() => setNotice("The people import guide will be added in a later step.")} role="button" tabIndex={0} onKeyDown={(event) => event.key === "Enter" && setNotice("The people import guide will be added in a later step.")}><div className="import-icon"><Plus size={19} /></div><div className="stat-content"><span>Growing together</span><strong className="stat-action-title">Bring your list</strong><small>Import people from a file</small></div><span className="card-arrow">↗</span></article>
          </section>

          <section className="directory-card">
            <div className="directory-heading"><div><h2>People directory</h2><p>Keep your community close and connected.</p></div><button className="button button-secondary" type="button" onClick={() => setNotice("More filters will be available when contact data is connected.")}><SlidersHorizontal size={16} /> Filters</button></div>
            <div className="directory-toolbar"><div className="search-field"><Search size={17} /><input aria-label="Search people" placeholder="Search by name, email, or phone..." value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>⌘ K</kbd></div><div className="filter-tabs" role="tablist" aria-label="Filter by status"><button className={statusFilter === "all" ? "filter-tab filter-tab-active" : "filter-tab"} type="button" role="tab" aria-selected={statusFilter === "all"} onClick={() => setStatusFilter("all")}>All <span>{contacts.length}</span></button><button className={statusFilter === "member" ? "filter-tab filter-tab-active" : "filter-tab"} type="button" role="tab" aria-selected={statusFilter === "member"} onClick={() => setStatusFilter("member")}>Members <span>{contacts.filter((contact) => contact.status === "member").length}</span></button><button className={statusFilter === "visitor" ? "filter-tab filter-tab-active" : "filter-tab"} type="button" role="tab" aria-selected={statusFilter === "visitor"} onClick={() => setStatusFilter("visitor")}>Visitors <span>{contacts.filter((contact) => contact.status === "visitor").length}</span></button></div><button className="icon-button sort-button" type="button" aria-label="Sort people" onClick={() => setNotice("People are currently sorted by first name.")}><SlidersHorizontal size={17} /></button></div>

            <div className="table-scroll"><table className="people-table"><thead><tr><th><input type="checkbox" aria-label="Select all people" onChange={() => setNotice("Bulk actions will be available when contact data is connected.")} /></th><th>PERSON</th><th>STATUS</th><th>EMAIL ADDRESS</th><th>PHONE</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
              {visibleContacts.map((contact, index) => <tr key={contact.id}><td><input type="checkbox" aria-label={`Select ${contact.firstName} ${contact.lastName}`} /></td><td><div className="person-cell"><div className={`person-avatar avatar-${index % 6}`}>{initials(contact)}</div><div><strong>{contact.firstName} {contact.lastName}</strong><small>{department.location}</small></div></div></td><td><span className={`status-pill ${contact.status === "member" ? "status-member" : "status-visitor"}`}><span />{contact.status === "member" ? "Member" : "Visitor"}</span></td><td className="muted-cell">{contact.email || "—"}</td><td className="muted-cell">{contact.phone || "—"}</td><td><button className="row-more" type="button" aria-label={`More actions for ${contact.firstName} ${contact.lastName}`} onClick={() => setNotice("Contact profiles will be added in a later step.")}>•••</button></td></tr>)}
              {visibleContacts.length === 0 && <tr><td colSpan={6} className="empty-state">{isLoading ? "Loading people…" : loadError ? "People could not be loaded." : "No people yet. Add someone to get started."}</td></tr>}
            </tbody></table></div>
            <footer className="table-footer"><span>Showing <strong>{visibleContacts.length ? 1 : 0}–{visibleContacts.length}</strong> of <strong>{visibleContacts.length}</strong> people</span><div className="pagination"><button className="page-button" type="button" disabled>Previous</button><button className="page-number" type="button" aria-current="page">1</button><button className="page-button" type="button" disabled>Next</button></div></footer>
          </section>

          <footer className="page-footer"><span>Made for the moments that matter.</span><span>© 2026 Smart Church</span></footer>
          </>}
        </div>
      </main>

      {notice && <div className="toast" role="status"><Check size={17} />{notice}<button className="toast-close" type="button" aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={15} /></button></div>}

      {isMySettingsOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setIsMySettingsOpen(false)}><section className="modal my-settings-modal" role="dialog" aria-modal="true" aria-labelledby="my-settings-title"><div className="modal-heading"><div><span className="eyebrow">PERSONAL PREFERENCES</span><h2 id="my-settings-title">My Settings</h2><p>Choose how Smart Church looks for you.</p></div><button className="icon-button" type="button" aria-label="Close dialog" onClick={() => setIsMySettingsOpen(false)}><X size={19} /></button></div><section className="my-settings-section" aria-labelledby="appearance-title"><div><h3 id="appearance-title">Appearance</h3><p>Choose light or dark mode for this browser.</p></div><div className="theme-options" role="group" aria-label="Color theme"><button className={`theme-option ${theme === "light" ? "theme-option-active" : ""}`} type="button" aria-pressed={theme === "light"} onClick={() => setTheme("light")}><Sun size={17} />Light</button><button className={`theme-option ${theme === "dark" ? "theme-option-active" : ""}`} type="button" aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}><Moon size={17} />Dark</button></div></section><p className="modal-demo-footnote">Preferences are saved on this device.</p></section></div>}

      {isServerSettingsOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setIsServerSettingsOpen(false)}><section className="modal server-settings-modal" role="dialog" aria-modal="true" aria-labelledby="server-settings-title"><div className="modal-heading"><div><span className="eyebrow">SITE SWITCHER</span><h2 id="server-settings-title">Switch site</h2><p>Choose the GfC site you want to work in on this server.</p></div><button className="icon-button" type="button" aria-label="Close dialog" onClick={() => setIsServerSettingsOpen(false)}><X size={19} /></button></div><div className="server-site-list" role="group" aria-label="Sites on this server">{departments.map((site) => <button className={`server-site-choice ${site.id === department.id ? "server-site-choice-active" : ""}`} type="button" disabled={site.role === "unassigned"} aria-current={site.id === department.id ? "true" : undefined} key={site.id} onClick={() => { switchDepartment(site.id); setIsServerSettingsOpen(false); }}><span className="server-settings-icon"><Server size={18} /></span><span className="server-site-details"><strong>{site.location}</strong><small>{site.timeZone}{site.role === "unassigned" ? " · Assign yourself in User access first" : ""}</small></span><span className="server-site-state">{site.id === department.id ? "Current site" : site.role === "unassigned" ? "No access" : "Switch"}</span></button>)}{departments.length === 0 && <p className="server-settings-empty">No sites are configured on this server yet.</p>}</div><p className="modal-demo-footnote">Signed in as Server Administrator</p></section></div>}

      {isUserAccessOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setIsUserAccessOpen(false)}><section className="modal user-access-modal" role="dialog" aria-modal="true" aria-labelledby="user-access-title"><div className="modal-heading"><div><span className="eyebrow">SERVER ADMINISTRATION</span><h2 id="user-access-title">User access</h2><p>Create local accounts and choose the sites they can use.</p></div><button className="icon-button" type="button" aria-label="Close dialog" onClick={() => setIsUserAccessOpen(false)}><X size={19} /></button></div><div className="user-access-layout"><aside className="user-access-list"><button className="button button-secondary user-add-button" type="button" onClick={startNewSiteUser}><Plus size={16} /> Add user</button>{isUsersLoading ? <p className="user-access-empty">Loading accounts…</p> : siteUsers.length === 0 ? <p className="user-access-empty">No local users yet.</p> : siteUsers.map((user) => <button className={`user-access-item ${editingUserId === user.id ? "user-access-item-active" : ""}`} type="button" key={user.id} onClick={() => editSiteUser(user)}><strong>{user.displayName}</strong><small>@{user.username} · {user.email ?? "No email address"}</small><span>{user.accountRole === "server_admin" ? "Server Administrator" : "Local user"} · {user.memberships.length} {user.memberships.length === 1 ? "site" : "sites"}</span></button>)}</aside><form className="user-access-form" onSubmit={saveSiteUser}><div className="user-access-form-heading"><h3>{editingUserId ? "Edit user access" : "Create account"}</h3><p>Members can view basic people details; site administrators can manage site data. Users sign in with their username; email is optional.</p></div>{editingUser && editingUser.id !== authUser.id && <section className="password-reset-panel" aria-label="Reset user password"><div className="password-reset-heading"><KeyRound size={15} /><strong>Reset password</strong></div>{!isResettingPassword ? <><p>Set a new password for this user. Their current sessions will be signed out.</p><button className="button button-secondary" type="button" onClick={() => { setResetPassword(generateInitialPassword()); setForcePasswordChange(true); setResetPasswordSaved(false); setIsResettingPassword(true); setUserAccessFeedback(null); }}>Reset password</button></> : <><label>Temporary password<div className="generated-password-row"><input value={resetPassword} readOnly={resetPasswordSaved} onChange={(event) => setResetPassword(event.target.value)} autoComplete="off" minLength={6} maxLength={128} aria-label="Temporary password" />{!resetPasswordSaved && <button className="button button-secondary" type="button" onClick={() => setResetPassword(generateInitialPassword())}>Generate</button>}<button className="button button-secondary generated-copy-button" type="button" onClick={() => void copyResetPassword()}><Copy size={15} />Copy</button></div></label>{!resetPasswordSaved && <label className="global-admin-option"><input type="checkbox" checked={forcePasswordChange} onChange={(event) => setForcePasswordChange(event.target.checked)} /><span><strong>Require password change at next sign-in</strong><small>Checked by default. The user must choose a new password before using the app.</small></span></label>}<div className="password-reset-actions">{!resetPasswordSaved && <button className="button button-primary" type="button" onClick={() => void resetSiteUserPassword()} disabled={isPasswordResetting || resetPassword.length < 6}><KeyRound size={15} />{isPasswordResetting ? "Resetting…" : "Confirm reset"}</button>}<button className="button button-secondary" type="button" onClick={() => { setIsResettingPassword(false); setResetPassword(""); setResetPasswordSaved(false); }}> {resetPasswordSaved ? "Close" : "Cancel"}</button></div></>}</section>}<label>Full name<input key={`name-${editingUserId ?? "new"}`} name="displayName" defaultValue={editingUser?.displayName ?? ""} required maxLength={100} /></label><label>Username<input key={`username-${editingUserId ?? "new"}`} name="username" defaultValue={editingUser?.username ?? ""} required minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" autoComplete="username" /></label><label>Email address <span className="optional-label">Optional</span><input key={`email-${editingUserId ?? "new"}`} name="email" type="email" defaultValue={editingUser?.email ?? ""} maxLength={254} autoComplete="email" /></label><label>Birthday <span className="optional-label">Optional · DD:MM:YYYY</span><input key={`birthday-${editingUserId ?? "new"}`} name="birthday" defaultValue={editingUser?.birthday ?? ""} placeholder="DD:MM:YYYY" inputMode="numeric" pattern="\d{2}:\d{2}:\d{4}" maxLength={10} /></label><div className="form-row user-address-row"><label>Street / road <span className="optional-label">Optional</span><input key={`street-${editingUserId ?? "new"}`} name="street" defaultValue={editingUser?.street ?? ""} maxLength={160} autoComplete="street-address" /></label><label>Number<input key={`street-number-${editingUserId ?? "new"}`} name="streetNumber" defaultValue={editingUser?.streetNumber ?? ""} maxLength={24} /></label></div><div className="form-row user-address-row"><label>PLZ / postal code<input key={`postal-code-${editingUserId ?? "new"}`} name="postalCode" defaultValue={editingUser?.postalCode ?? ""} maxLength={20} autoComplete="postal-code" /></label><label>City<input key={`city-${editingUserId ?? "new"}`} name="city" defaultValue={editingUser?.city ?? ""} maxLength={100} autoComplete="address-level2" /></label></div><section className="user-phone-section" aria-labelledby="user-phone-heading"><div className="user-profile-section-heading"><strong id="user-phone-heading">Phone numbers</strong><span className="optional-label">Optional</span></div>{userPhoneNumbers.map((phone, index) => <div className="user-phone-row" key={index}><select aria-label={`Phone number ${index + 1} label`} value={phone.label} onChange={(event) => setUserPhoneNumbers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value as UserPhoneLabel } : item))}><option value="home">Home</option><option value="mobile">Mobile</option><option value="work">Work</option><option value="work_mobile">Work mobile</option></select><input type="tel" aria-label={`Phone number ${index + 1}`} value={phone.number} maxLength={32} placeholder="+41 …" onChange={(event) => setUserPhoneNumbers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, number: event.target.value } : item))} /><button className="icon-button user-phone-remove" type="button" aria-label={`Remove phone number ${index + 1}`} onClick={() => setUserPhoneNumbers((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button></div>)}<button className="button button-secondary user-profile-add-button" type="button" onClick={() => setUserPhoneNumbers((current) => [...current, { label: "mobile", number: "" }])}><Plus size={15} /> Add phone number</button></section><section className="user-phone-section" aria-labelledby="user-relationships-heading"><div className="user-profile-section-heading"><strong id="user-relationships-heading">Relationships</strong><span className="optional-label">Optional</span></div>{userRelationships.map((relationship, index) => <div className="user-relationship-row" key={index}><select aria-label={`Related user ${index + 1}`} value={relationship.relatedUserId} onChange={(event) => setUserRelationships((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, relatedUserId: event.target.value } : item))}><option value="">Choose a user</option>{siteUsers.filter((user) => user.id !== editingUserId).map((user) => <option key={user.id} value={user.id} disabled={userRelationships.some((item, itemIndex) => itemIndex !== index && item.relatedUserId === user.id)}>{user.displayName} (@{user.username})</option>)}</select><select aria-label={`Relationship type ${index + 1}`} value={relationship.relationship} onChange={(event) => setUserRelationships((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, relationship: event.target.value as UserRelationshipKind } : item))}><option value="spouse">Spouse</option><option value="parent">Parent of</option><option value="child">Child of</option><option value="sibling">Sibling</option><option value="guardian">Guardian of</option><option value="ward">Ward of</option><option value="other">Other</option></select><button className="icon-button user-phone-remove" type="button" aria-label={`Remove relationship ${index + 1}`} onClick={() => setUserRelationships((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button></div>)}<button className="button button-secondary user-profile-add-button" type="button" onClick={() => setUserRelationships((current) => [...current, { relatedUserId: "", relationship: "spouse" }])} disabled={siteUsers.filter((user) => user.id !== editingUserId).length === 0}><Plus size={15} /> Add relationship</button><small className="user-access-hint">Relationships are reciprocal. For example, marking someone as a parent shows them as your child.</small></section>{(!editingUserId || (isPasswordSaved && generatedPassword)) && <label>{isPasswordSaved ? "Initial password (copy it now)" : "Suggested password"}<div className="generated-password-row"><input value={generatedPassword} readOnly={isPasswordSaved} onChange={(event) => setGeneratedPassword(event.target.value)} autoComplete="off" aria-label="Initial password" minLength={6} maxLength={128} />{!isPasswordSaved && <button className="button button-secondary" type="button" onClick={() => setGeneratedPassword(generateInitialPassword())}>Generate</button>}<button className="button button-secondary generated-copy-button" type="button" onClick={() => void copyGeneratedPassword()} aria-label="Copy generated password"><Copy size={15} />Copy</button></div><small className="user-access-hint">{isPasswordSaved ? "It is stored as a hash and cannot be shown again after you close this screen." : "Suggested securely. Edit it or generate another. Use at least 6 characters, then give it to the user directly."}</small></label>}<fieldset className="user-membership-fieldset"><legend>Site memberships</legend>{departments.map((site) => <div className="user-membership-row user-membership-row-expanded" key={site.id}><label className="user-membership-check"><input type="checkbox" checked={Boolean(userMemberships[site.id])} onChange={(event) => setUserMemberships((current) => { const next = { ...current }; if (event.target.checked) next[site.id] = { role: "member", videoPermissions: [], presenterPermissions: [] }; else delete next[site.id]; return next; })} /><span><strong>{site.location}</strong><small>{site.timeZone}</small></span></label>{userMemberships[site.id] && <><select aria-label={`${site.location} role`} value={userMemberships[site.id].role} onChange={(event) => setUserMemberships((current) => ({ ...current, [site.id]: { ...current[site.id], role: event.target.value as "site_admin" | "member" } }))}><option value="member">Member</option><option value="site_admin">Site administrator</option></select>{site.enabledModules?.includes("video") && <fieldset className="module-rights-fieldset"><legend>Video rights</legend>{userMemberships[site.id].role === "site_admin" ? <small>Site administrators inherit all Video rights.</small> : videoPermissionOptions.map(({ value, label, description }) => <label className="module-right-option" key={value}><input type="checkbox" checked={userMemberships[site.id].videoPermissions.includes(value)} onChange={(event) => setUserMemberships((current) => { const member = current[site.id]; const permissions = event.target.checked ? [...new Set([...member.videoPermissions, value])] : member.videoPermissions.filter((item) => item !== value); return { ...current, [site.id]: { ...member, videoPermissions: permissions } }; })} /><span><strong>{label}</strong><small>{description}</small></span></label>)}</fieldset>}{site.enabledModules?.includes("presenter") && <fieldset className="module-rights-fieldset"><legend>Presenter rights</legend>{userMemberships[site.id].role === "site_admin" ? <small>Site administrators inherit all Presenter rights.</small> : presenterPermissionOptions.map(({ value, label, description }) => <label className="module-right-option" key={value}><input type="checkbox" checked={userMemberships[site.id].presenterPermissions.includes(value)} onChange={(event) => setUserMemberships((current) => { const member = current[site.id]; const permissions = event.target.checked ? [...new Set([...member.presenterPermissions, value])] : member.presenterPermissions.filter((item) => item !== value); return { ...current, [site.id]: { ...member, presenterPermissions: permissions } }; })} /><span><strong>{label}</strong><small>{description}</small></span></label>)}</fieldset>}</>}</div>)}</fieldset>{!editingUserId && authUser.role === "server_admin" && <label className="global-admin-option"><input type="checkbox" checked={newAccountRole === "server_admin"} onChange={(event) => setNewAccountRole(event.target.checked ? "server_admin" : "user")} /><span><strong>Grant Server Administrator access</strong><small>Only server administrators can grant this role. Site data still needs separate memberships.</small></span></label>}{userAccessFeedback && <p className={`user-access-feedback ${userAccessFeedback.isError ? "user-access-feedback-error" : ""}`} role={userAccessFeedback.isError ? "alert" : "status"} aria-live="polite">{userAccessFeedback.message}</p>}<div className="form-actions">{editingUser && <button className="button button-danger" type="button" onClick={() => void deleteSiteUser()} disabled={isUserSaving || isUserDeleting || editingUser.id === authUser.id} title={editingUser.id === authUser.id ? "You cannot delete your own account." : undefined}><Trash2 size={15} />{isUserDeleting ? "Deleting…" : "Delete user"}</button>}<button className="button button-secondary" type="button" onClick={() => setIsUserAccessOpen(false)}>Close</button><button className="button button-primary" type="submit" disabled={isUserSaving || isUsersLoading || (departments.length === 0 && newAccountRole !== "server_admin")}><Check size={16} />{isUserSaving ? "Saving…" : editingUserId ? "Save access" : "Create user"}</button></div><p className="modal-demo-footnote">Membership changes take effect on the next request.</p></form></div></section></div>}

      {isAddOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setIsAddOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="add-person-title"><div className="modal-heading"><div><span className="eyebrow">PEOPLE DIRECTORY</span><h2 id="add-person-title">Add a person</h2><p>Start with the details you have. You can add more later.</p></div><button className="icon-button" type="button" aria-label="Close dialog" onClick={() => setIsAddOpen(false)}><X size={19} /></button></div><form onSubmit={addContact}><div className="form-row"><label>First name<input name="firstName" autoFocus autoComplete="given-name" required /></label><label>Last name<input name="lastName" autoComplete="family-name" required /></label></div><label>Email address <span className="optional-label">Optional</span><input type="email" name="email" autoComplete="email" placeholder="name@example.com" /></label><label>Phone number <span className="optional-label">Optional</span><input type="tel" name="phone" autoComplete="tel" placeholder="+41 00 000 00 00" /></label><label>Relationship<select name="status" defaultValue="member"><option value="member">Member</option><option value="visitor">Visitor</option></select></label><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setIsAddOpen(false)}>Cancel</button><button className="button button-primary" type="submit" disabled={isSaving}><Plus size={17} /> {isSaving ? "Saving…" : "Add person"}</button></div></form></section></div>}

      {isBrandingOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setIsBrandingOpen(false)}><section className="modal branding-modal" role="dialog" aria-modal="true" aria-labelledby="branding-title"><div className="modal-heading"><div><span className="eyebrow">SITE ADMINISTRATION</span><h2 id="branding-title">Site logo</h2><p>Choose the logo shown at the top of the sidebar.</p></div><button className="icon-button" type="button" aria-label="Close dialog" onClick={() => setIsBrandingOpen(false)}><X size={19} /></button></div><div className="branding-preview"><img src={brandingDraft || defaultLogoUrl} alt="Logo preview" onError={(event) => { event.currentTarget.style.display = "none"; }} /></div><label className="branding-upload">Upload a logo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => selectBrandingLogo(event.currentTarget.files?.[0])} /></label><p className="branding-help">PNG, JPEG, or WebP · up to 2 MB. The GfC logo is used by default.</p><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setBrandingDraft(null)}>Use GfC default</button><button className="button button-secondary" type="button" onClick={() => setIsBrandingOpen(false)}>Cancel</button><button className="button button-primary" type="button" disabled={isBrandingSaving} onClick={saveBranding}>{isBrandingSaving ? "Saving…" : "Save logo"}</button></div><p className="modal-demo-footnote">Your signed-in account can update the logo for this installation.</p></section></div>}
      {isDepartmentOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setIsDepartmentOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="department-title"><div className="modal-heading"><div><span className="eyebrow">SITE MANAGEMENT</span><h2 id="department-title">Manage sites</h2><p>This server can host multiple GfC locations. People and events stay with their selected location.</p></div><button className="icon-button" type="button" aria-label="Close dialog" onClick={() => setIsDepartmentOpen(false)}><X size={19} /></button></div>
        {isAddingLocation ? <form onSubmit={addLocation}><label>Location<input name="location" autoFocus required maxLength={120} placeholder="Enter the location name" /></label><label>Time zone<input name="timeZone" required maxLength={80} defaultValue="Europe/Zurich" placeholder="Europe/Zurich" /></label><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setIsAddingLocation(false)}>Back</button><button className="button button-primary" type="submit" disabled={isDepartmentSaving}>{isDepartmentSaving ? "Adding…" : "Add location"}</button></div></form>
          : <><form onSubmit={saveDepartmentSettings}><label>Location<input autoFocus required maxLength={120} value={departmentDraft.location} onChange={(event) => setDepartmentDraft((current) => ({ ...current, location: event.target.value }))} placeholder="Enter your location" /></label><label>Time zone<input required maxLength={80} value={departmentDraft.timeZone} onChange={(event) => setDepartmentDraft((current) => ({ ...current, timeZone: event.target.value }))} placeholder="Europe/Zurich" /></label><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setIsDepartmentOpen(false)}>Cancel</button><button className="button button-primary" type="submit" disabled={isDepartmentSaving}>{isDepartmentSaving ? "Saving…" : "Save location"}</button></div></form><button className="button button-secondary location-add-button" type="button" onClick={() => setIsAddingLocation(true)}><Plus size={16} /> Add another location</button></>}
        </section></div>}
    </div>
  );
}

export { App };
