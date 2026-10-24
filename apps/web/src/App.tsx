import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  Church,
  CircleHelp,
  ContactRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Plus,
  Search,
  Server,
  Settings2,
  SlidersHorizontal,
  Sun,
  UsersRound,
  X,
} from "lucide-react";
import type { AuthenticatedUser, AuthStatus, Contact, ContactStatus, DepartmentProfile } from "@smart-church/contracts";
import { Authentication } from "./Authentication";
import { ServicesEvents } from "./ServicesEvents";

const navigation = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "People", icon: UsersRound },
  { label: "Services & events", icon: CalendarDays },
  { label: "Groups", icon: ContactRound },
  { label: "Resources", icon: BookOpen },
];

const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
const defaultLogoUrl = "/gfc-logo.svg";
const defaultDepartment: DepartmentProfile = {
  id: "",
  location: "Location not configured",
  timeZone: "Europe/Zurich",
};

function departmentFetch(input: RequestInfo | URL, init: RequestInit = {}, departmentId = "") {
  const headers = new Headers(init.headers);
  if (departmentId) headers.set("x-department-id", departmentId);
  return fetch(input, { ...init, headers });
}

function initials(contact: Contact) {
  return `${contact.firstName[0] ?? ""}${contact.lastName[0] ?? ""}`.toUpperCase();
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
  const [page, setPage] = useState<"People" | "Services & events">("People");
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
  const [authLoading, setAuthLoading] = useState(true);
  const [authUser, setAuthUser] = useState<AuthenticatedUser | null>(null);
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
    fetch("/api/auth/status")
      .then(async (response) => {
        const result = await response.json() as AuthStatus | { error?: string };
        if (!response.ok || !("authenticated" in result)) throw new Error("error" in result ? result.error ?? "Could not check sign-in status." : "Could not check sign-in status.");
        setSetupRequired(result.setupRequired);
        setAuthUser(result.user ?? null);
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
        const selected = availableDepartments.find((item) => item.id === selectedId) ?? availableDepartments[0];
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
    if (!selected) return;
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

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Clear the local view even if the API has gone offline; the server session expires on its own.
    } finally {
      setAuthUser(null);
      setContacts([]);
      setLogoDataUrl(null);
      setDepartment(defaultDepartment);
      setDepartments([]);
      setIsBrandingOpen(false);
      setIsDepartmentOpen(false);
    }
  }

  const memberCount = contacts.filter((contact) => contact.status === "member").length;
  const visitorCount = contacts.filter((contact) => contact.status === "visitor").length;

  if (authLoading) return <main className="auth-page"><section className="auth-card auth-loading" role="status"><span className="eyebrow">GFC WORKSPACE</span><p>Checking your sign-in…</p></section></main>;
  if (!authUser) return <Authentication setupRequired={setupRequired} unavailableMessage={authUnavailableMessage} onAuthenticated={(user) => { setAuthUnavailableMessage(""); setSetupRequired(false); setAuthUser(user); }} />;

  const userInitials = authUser.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || authUser.email[0]?.toUpperCase() || "U";

  return (
    <div className="app-frame">
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <a className="brand" href="#home" aria-label={`Church home · ${department.location}`}>
          {logoUnavailable ? <><span className="brand-mark"><Church size={21} strokeWidth={1.8} /></span><span className="brand-name">smart<span>church</span></span></> : <img className="brand-custom-logo" src={logoSrc} alt="GfC logo" onError={() => setLogoUnavailable(true)} />}
          <span className="brand-location">{department.location}</span>
        </a>

        <div className="church-switcher">
          <span className="church-avatar">G</span>
          <label className="church-details"><strong>GfC location</strong><select className="church-location-select" aria-label="Active location" value={department.id} onChange={(event) => switchDepartment(event.target.value)}>{departments.map((item) => <option value={item.id} key={item.id}>{item.location}</option>)}</select></label>
          <button className="icon-button church-location-settings" type="button" aria-label="Manage locations" title="Manage locations" onClick={openDepartmentSettings}><Settings2 size={16} /></button>
        </div>

        <div className="nav-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map(({ label, icon: Icon }) => {
            const isAvailablePage = label === "People" || label === "Services & events";
            const active = page === label;
            return <button className={`nav-item ${active ? "nav-item-active" : ""}`} type="button" key={label} onClick={() => {
              if (isAvailablePage) {
                setPage(label);
                setMenuOpen(false);
              } else setNotice(`${label} will be added in a later step.`);
            }}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>{active && <span className="nav-indicator" />}
            </button>
          })}
        </nav>

        <div className="sidebar-bottom">
          <button className="nav-item" type="button" onClick={() => setNotice("Notifications will be added in a later step.")}><Bell size={18} strokeWidth={1.8} /><span>Notifications</span><span className="notification-dot" /></button>
          <button className="nav-item" type="button" onClick={() => setIsMySettingsOpen(true)}><Settings2 size={18} strokeWidth={1.8} /><span>My Settings</span></button>
          <button className="nav-item" type="button" onClick={() => setIsServerSettingsOpen(true)}><Server size={18} strokeWidth={1.8} /><span>Server settings</span></button>
          <button className="nav-item" type="button" onClick={() => setNotice("Help will be added in a later step.")}><CircleHelp size={18} strokeWidth={1.8} /><span>Help & support</span></button>
          <div className="profile-card">
            <div className="profile-avatar">{userInitials}</div>
            <div className="profile-details"><strong>{authUser.displayName}</strong><small>Server Administrator</small></div>
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

        <div className="page-wrap">
          {page === "Services & events" ? <ServicesEvents departmentId={department.id} departmentLocation={department.location} departmentTimeZone={department.timeZone} onNotice={setNotice} /> : <>
          <div className={`demo-notice ${loadError ? "demo-notice-error" : ""}`}><span className="demo-dot" />{loadError ? `Workspace unavailable · ${loadError}` : `People are saved for ${department.location}`}</div>

          <section className="page-heading">
            <div>
              <div className="eyebrow">YOUR COMMUNITY</div>
              <h1>People</h1>
              <p className="page-subtitle">A thoughtful place to care for the people in your church.</p>
            </div>
            <button className="button button-primary" type="button" onClick={() => setIsAddOpen(true)}><Plus size={18} /> Add a person</button>
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

      {isServerSettingsOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setIsServerSettingsOpen(false)}><section className="modal server-settings-modal" role="dialog" aria-modal="true" aria-labelledby="server-settings-title"><div className="modal-heading"><div><span className="eyebrow">SERVER ADMINISTRATION</span><h2 id="server-settings-title">Switch site</h2><p>Choose the GfC site you want to work in on this server.</p></div><button className="icon-button" type="button" aria-label="Close dialog" onClick={() => setIsServerSettingsOpen(false)}><X size={19} /></button></div><div className="server-site-list" role="group" aria-label="Sites on this server">{departments.map((site) => <button className={`server-site-choice ${site.id === department.id ? "server-site-choice-active" : ""}`} type="button" aria-current={site.id === department.id ? "true" : undefined} key={site.id} onClick={() => { switchDepartment(site.id); setIsServerSettingsOpen(false); }}><span className="server-settings-icon"><Server size={18} /></span><span className="server-site-details"><strong>{site.location}</strong><small>{site.timeZone}</small></span><span className="server-site-state">{site.id === department.id ? "Current site" : "Switch"}</span></button>)}{departments.length === 0 && <p className="server-settings-empty">No sites are configured on this server yet.</p>}</div><p className="modal-demo-footnote">Signed in as Server Administrator</p></section></div>}

      {isAddOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setIsAddOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="add-person-title"><div className="modal-heading"><div><span className="eyebrow">PEOPLE DIRECTORY</span><h2 id="add-person-title">Add a person</h2><p>Start with the details you have. You can add more later.</p></div><button className="icon-button" type="button" aria-label="Close dialog" onClick={() => setIsAddOpen(false)}><X size={19} /></button></div><form onSubmit={addContact}><div className="form-row"><label>First name<input name="firstName" autoFocus autoComplete="given-name" required /></label><label>Last name<input name="lastName" autoComplete="family-name" required /></label></div><label>Email address <span className="optional-label">Optional</span><input type="email" name="email" autoComplete="email" placeholder="name@example.com" /></label><label>Phone number <span className="optional-label">Optional</span><input type="tel" name="phone" autoComplete="tel" placeholder="+41 00 000 00 00" /></label><label>Relationship<select name="status" defaultValue="member"><option value="member">Member</option><option value="visitor">Visitor</option></select></label><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setIsAddOpen(false)}>Cancel</button><button className="button button-primary" type="submit" disabled={isSaving}><Plus size={17} /> {isSaving ? "Saving…" : "Add person"}</button></div></form></section></div>}

      {isBrandingOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setIsBrandingOpen(false)}><section className="modal branding-modal" role="dialog" aria-modal="true" aria-labelledby="branding-title"><div className="modal-heading"><div><span className="eyebrow">SITE ADMINISTRATION</span><h2 id="branding-title">Site logo</h2><p>Choose the logo shown at the top of the sidebar.</p></div><button className="icon-button" type="button" aria-label="Close dialog" onClick={() => setIsBrandingOpen(false)}><X size={19} /></button></div><div className="branding-preview"><img src={brandingDraft || defaultLogoUrl} alt="Logo preview" onError={(event) => { event.currentTarget.style.display = "none"; }} /></div><label className="branding-upload">Upload a logo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => selectBrandingLogo(event.currentTarget.files?.[0])} /></label><p className="branding-help">PNG, JPEG, or WebP · up to 2 MB. The GfC logo is used by default.</p><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setBrandingDraft(null)}>Use GfC default</button><button className="button button-secondary" type="button" onClick={() => setIsBrandingOpen(false)}>Cancel</button><button className="button button-primary" type="button" disabled={isBrandingSaving} onClick={saveBranding}>{isBrandingSaving ? "Saving…" : "Save logo"}</button></div><p className="modal-demo-footnote">Your signed-in account can update the logo for this installation.</p></section></div>}
      {isDepartmentOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setIsDepartmentOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="department-title"><div className="modal-heading"><div><span className="eyebrow">GFC LOCATIONS</span><h2 id="department-title">Manage locations</h2><p>This installation can serve multiple GfC locations. People and events stay with their selected location.</p></div><button className="icon-button" type="button" aria-label="Close dialog" onClick={() => setIsDepartmentOpen(false)}><X size={19} /></button></div>
        {isAddingLocation ? <form onSubmit={addLocation}><label>Location<input name="location" autoFocus required maxLength={120} placeholder="Enter the location name" /></label><label>Time zone<input name="timeZone" required maxLength={80} defaultValue="Europe/Zurich" placeholder="Europe/Zurich" /></label><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setIsAddingLocation(false)}>Back</button><button className="button button-primary" type="submit" disabled={isDepartmentSaving}>{isDepartmentSaving ? "Adding…" : "Add location"}</button></div></form>
          : <><form onSubmit={saveDepartmentSettings}><label>Location<input autoFocus required maxLength={120} value={departmentDraft.location} onChange={(event) => setDepartmentDraft((current) => ({ ...current, location: event.target.value }))} placeholder="Enter your location" /></label><label>Time zone<input required maxLength={80} value={departmentDraft.timeZone} onChange={(event) => setDepartmentDraft((current) => ({ ...current, timeZone: event.target.value }))} placeholder="Europe/Zurich" /></label><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setIsDepartmentOpen(false)}>Cancel</button><button className="button button-primary" type="submit" disabled={isDepartmentSaving}>{isDepartmentSaving ? "Saving…" : "Save location"}</button></div></form><button className="button button-secondary location-add-button" type="button" onClick={() => setIsAddingLocation(true)}><Plus size={16} /> Add another location</button></>}
        </section></div>}
    </div>
  );
}

export { App };
