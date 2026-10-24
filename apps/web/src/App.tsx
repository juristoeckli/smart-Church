import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  Church,
  CircleHelp,
  ContactRound,
  LayoutDashboard,
  Menu,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  UsersRound,
  X,
} from "lucide-react";
import type { Contact, ContactStatus } from "@smart-church/contracts";

const navigation = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "People", icon: UsersRound, active: true },
  { label: "Services & events", icon: CalendarDays },
  { label: "Groups", icon: ContactRound },
  { label: "Resources", icon: BookOpen },
];

const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", month: "long", day: "numeric" }).format(new Date());

function initials(contact: Contact) {
  return `${contact.firstName[0] ?? ""}${contact.lastName[0] ?? ""}`.toUpperCase();
}

function App() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ContactStatus>("all");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    fetch("/api/contacts")
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not load contacts.");
        setContacts(result as Contact[]);
      })
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : "Could not load contacts."))
      .finally(() => setIsLoading(false));
  }, []);

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
      const response = await fetch("/api/contacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
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

  const memberCount = contacts.filter((contact) => contact.status === "member").length;
  const visitorCount = contacts.filter((contact) => contact.status === "visitor").length;

  return (
    <div className="app-frame">
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <a className="brand" href="#home" aria-label="Smart Church home">
          <span className="brand-mark"><Church size={21} strokeWidth={1.8} /></span>
          <span className="brand-name">smart<span>church</span></span>
        </a>

        <button className="church-switcher" type="button" aria-label="Select church">
          <span className="church-avatar">G</span>
          <span className="church-details"><strong>Grace Community</strong><small>Zurich, Switzerland</small></span>
          <ChevronDown size={16} />
        </button>

        <div className="nav-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map(({ label, icon: Icon, active }) => (
            <button className={`nav-item ${active ? "nav-item-active" : ""}`} type="button" key={label} onClick={() => label !== "People" && setNotice(`${label} will be added in a later step.`)}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>{active && <span className="nav-indicator" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button className="nav-item" type="button" onClick={() => setNotice("Notifications will be added in a later step.")}><Bell size={18} strokeWidth={1.8} /><span>Notifications</span><span className="notification-dot" /></button>
          <button className="nav-item" type="button" onClick={() => setNotice("Settings will be added in a later step.")}><Settings2 size={18} strokeWidth={1.8} /><span>Settings</span></button>
          <button className="nav-item" type="button" onClick={() => setNotice("Help will be added in a later step.")}><CircleHelp size={18} strokeWidth={1.8} /><span>Help & support</span></button>
          <div className="profile-card">
            <div className="profile-avatar">JM</div>
            <div className="profile-details"><strong>Jordan Miller</strong><small>Administrator</small></div>
            <button className="icon-button profile-menu" type="button" aria-label="Profile menu" onClick={() => setNotice("Account settings will be added in a later step.")}><ChevronDown size={16} /></button>
          </div>
        </div>
      </aside>

      {menuOpen && <button className="mobile-scrim" type="button" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}

      <main className="main-content">
        <header className="topbar">
          <button className="icon-button mobile-menu-button" type="button" aria-label="Open menu" onClick={() => setMenuOpen(true)}><Menu size={21} /></button>
          <div className="breadcrumbs"><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>People</strong></div>
          <div className="topbar-actions"><span className="date-label">{today}</span><button className="icon-button topbar-bell" aria-label="Notifications" type="button" onClick={() => setNotice("You’re all caught up.")}><Bell size={19} /></button><div className="topbar-avatar">JM</div></div>
        </header>

        <div className="page-wrap">
          <div className={`demo-notice ${loadError ? "demo-notice-error" : ""}`}><span className="demo-dot" />{loadError ? `Database unavailable · ${loadError}` : "Local workspace · People are saved to the configured department database"}</div>

          <section className="page-heading">
            <div>
              <div className="eyebrow">YOUR COMMUNITY</div>
              <h1>People</h1>
              <p className="page-subtitle">A thoughtful place to care for the people in your church.</p>
            </div>
            <button className="button button-primary" type="button" onClick={() => setIsAddOpen(true)}><Plus size={18} /> Add a person</button>
          </section>

          <section className="stat-grid" aria-label="People summary">
            <article className="stat-card"><div className="stat-icon stat-icon-green"><UsersRound size={19} /></div><div className="stat-content"><span>Total people</span><strong>{contacts.length}</strong><small>In this department</small></div></article>
            <article className="stat-card"><div className="stat-icon stat-icon-blue"><Church size={18} /></div><div className="stat-content"><span>Members</span><strong>{memberCount}</strong><small>In this department</small></div></article>
            <article className="stat-card"><div className="stat-icon stat-icon-amber"><ContactRound size={19} /></div><div className="stat-content"><span>Visitors</span><strong>{visitorCount}</strong><small>In this department</small></div></article>
            <article className="stat-card stat-card-action" onClick={() => setNotice("The people import guide will be added in a later step.")} role="button" tabIndex={0} onKeyDown={(event) => event.key === "Enter" && setNotice("The people import guide will be added in a later step.")}><div className="import-icon"><Plus size={19} /></div><div className="stat-content"><span>Growing together</span><strong className="stat-action-title">Bring your list</strong><small>Import people from a file</small></div><span className="card-arrow">↗</span></article>
          </section>

          <section className="directory-card">
            <div className="directory-heading"><div><h2>People directory</h2><p>Keep your community close and connected.</p></div><button className="button button-secondary" type="button" onClick={() => setNotice("More filters will be available when contact data is connected.")}><SlidersHorizontal size={16} /> Filters</button></div>
            <div className="directory-toolbar"><div className="search-field"><Search size={17} /><input aria-label="Search people" placeholder="Search by name, email, or phone..." value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>⌘ K</kbd></div><div className="filter-tabs" role="tablist" aria-label="Filter by status"><button className={statusFilter === "all" ? "filter-tab filter-tab-active" : "filter-tab"} type="button" role="tab" aria-selected={statusFilter === "all"} onClick={() => setStatusFilter("all")}>All <span>{contacts.length}</span></button><button className={statusFilter === "member" ? "filter-tab filter-tab-active" : "filter-tab"} type="button" role="tab" aria-selected={statusFilter === "member"} onClick={() => setStatusFilter("member")}>Members <span>{contacts.filter((contact) => contact.status === "member").length}</span></button><button className={statusFilter === "visitor" ? "filter-tab filter-tab-active" : "filter-tab"} type="button" role="tab" aria-selected={statusFilter === "visitor"} onClick={() => setStatusFilter("visitor")}>Visitors <span>{contacts.filter((contact) => contact.status === "visitor").length}</span></button></div><button className="icon-button sort-button" type="button" aria-label="Sort people" onClick={() => setNotice("People are currently sorted by first name.")}><SlidersHorizontal size={17} /></button></div>

            <div className="table-scroll"><table className="people-table"><thead><tr><th><input type="checkbox" aria-label="Select all people" onChange={() => setNotice("Bulk actions will be available when contact data is connected.")} /></th><th>PERSON</th><th>STATUS</th><th>EMAIL ADDRESS</th><th>PHONE</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
              {visibleContacts.map((contact, index) => <tr key={contact.id}><td><input type="checkbox" aria-label={`Select ${contact.firstName} ${contact.lastName}`} /></td><td><div className="person-cell"><div className={`person-avatar avatar-${index % 6}`}>{initials(contact)}</div><div><strong>{contact.firstName} {contact.lastName}</strong><small>Zurich campus</small></div></div></td><td><span className={`status-pill ${contact.status === "member" ? "status-member" : "status-visitor"}`}><span />{contact.status === "member" ? "Member" : "Visitor"}</span></td><td className="muted-cell">{contact.email || "—"}</td><td className="muted-cell">{contact.phone || "—"}</td><td><button className="row-more" type="button" aria-label={`More actions for ${contact.firstName} ${contact.lastName}`} onClick={() => setNotice("Contact profiles will be added in a later step.")}>•••</button></td></tr>)}
              {visibleContacts.length === 0 && <tr><td colSpan={6} className="empty-state">{isLoading ? "Loading people…" : loadError ? "People could not be loaded." : "No people yet. Add someone to get started."}</td></tr>}
            </tbody></table></div>
            <footer className="table-footer"><span>Showing <strong>{visibleContacts.length ? 1 : 0}–{visibleContacts.length}</strong> of <strong>{visibleContacts.length}</strong> people</span><div className="pagination"><button className="page-button" type="button" disabled>Previous</button><button className="page-number" type="button" aria-current="page">1</button><button className="page-button" type="button" disabled>Next</button></div></footer>
          </section>

          <footer className="page-footer"><span>Made for the moments that matter.</span><span>© 2026 Smart Church</span></footer>
        </div>
      </main>

      {notice && <div className="toast" role="status"><Check size={17} />{notice}<button className="toast-close" type="button" aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={15} /></button></div>}

      {isAddOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setIsAddOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="add-person-title"><div className="modal-heading"><div><span className="eyebrow">PEOPLE DIRECTORY</span><h2 id="add-person-title">Add a person</h2><p>Start with the details you have. You can add more later.</p></div><button className="icon-button" type="button" aria-label="Close dialog" onClick={() => setIsAddOpen(false)}><X size={19} /></button></div><form onSubmit={addContact}><div className="form-row"><label>First name<input name="firstName" autoFocus autoComplete="given-name" required /></label><label>Last name<input name="lastName" autoComplete="family-name" required /></label></div><label>Email address <span className="optional-label">Optional</span><input type="email" name="email" autoComplete="email" placeholder="name@example.com" /></label><label>Phone number <span className="optional-label">Optional</span><input type="tel" name="phone" autoComplete="tel" placeholder="+41 00 000 00 00" /></label><label>Relationship<select name="status" defaultValue="member"><option value="member">Member</option><option value="visitor">Visitor</option></select></label><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => setIsAddOpen(false)}>Cancel</button><button className="button button-primary" type="submit" disabled={isSaving}><Plus size={17} /> {isSaving ? "Saving…" : "Add person"}</button></div></form></section></div>}
    </div>
  );
}

export { App };
