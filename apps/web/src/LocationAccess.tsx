import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, Plus, Trash2, UsersRound, X } from "lucide-react";
import type { DepartmentProfile, LocationPermission } from "@smart-church/contracts";
import { registeredModules } from "./module-registry";
import "./LocationAccess.css";

type LocationMember = {
  id: string;
  displayName: string;
  username: string;
  role: "site_admin" | "member";
  permissions: LocationPermission[];
  modulePermissions: Record<string, string[]>;
};
type LocationAccessData = {
  currentUserId: string;
  members: LocationMember[];
  availableUsers: Array<{ id: string; displayName: string; username: string }>;
};

const locationRights: Array<{ value: LocationPermission; label: string; description: string }> = [
  { value: "people_view_private", label: "View private contact details", description: "See email addresses and phone numbers in People." },
  { value: "people_manage", label: "Manage people", description: "Add, edit, delete and import people." },
  { value: "events_manage", label: "Manage services and events", description: "Create, edit and delete schedule entries." },
  { value: "groups_manage", label: "Manage groups", description: "Create groups and manage their membership." },
  { value: "resources_manage", label: "Manage resources", description: "Manage rooms, equipment and booking approvals." },
  { value: "files_manage", label: "Manage files", description: "Upload, rename and delete shared files." },
];
export function LocationAccess({ department, csrfToken, onClose, embedded = false }: { department: DepartmentProfile; csrfToken: string; onClose: () => void; embedded?: boolean }) {
  const [members, setMembers] = useState<LocationMember[]>([]);
  const [availableUsers, setAvailableUsers] = useState<LocationAccessData["availableUsers"]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [addUserId, setAddUserId] = useState("");
  const [role, setRole] = useState<LocationMember["role"]>("member");
  const [permissions, setPermissions] = useState<LocationPermission[]>([]);
  const [modulePermissions, setModulePermissions] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selected = useMemo(() => members.find((member) => member.id === selectedId) ?? null, [members, selectedId]);
  const enabledAccessModules = registeredModules.filter((module) => module.accessLevels?.length && (module.enabledByDefault || (department.enabledModules ?? []).includes(module.id)));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/location-access", { headers: { "x-department-id": department.id } });
      const result = await response.json() as LocationAccessData | { error?: string };
      if (!response.ok || !("members" in result)) throw new Error("error" in result ? result.error ?? "Could not load location access." : "Could not load location access.");
      setMembers(result.members);
      setAvailableUsers(result.availableUsers);
      setCurrentUserId(result.currentUserId);
      setSelectedId((current) => result.members.some((member) => member.id === current) ? current : result.members[0]?.id ?? "");
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load location access.");
    } finally { setLoading(false); }
  }, [department.id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selected) return;
    setRole(selected.role);
    setPermissions(selected.permissions);
    setModulePermissions(selected.modulePermissions);
  }, [selected]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/location-access/${encodeURIComponent(selected.id)}`, {
        method: "PUT",
        headers: { "x-department-id": department.id, "x-csrf-token": csrfToken, "content-type": "application/json" },
        body: JSON.stringify({ role, permissions, modulePermissions }),
      });
      const result = await response.json() as { member?: LocationMember; error?: string };
      if (!response.ok || !result.member) throw new Error(result.error ?? "Could not save access.");
      setMembers((current) => current.map((member) => member.id === result.member!.id ? result.member! : member));
      setNotice("Location access saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save access."); }
    finally { setSaving(false); }
  }

  async function addUser() {
    if (!addUserId) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/location-access/${encodeURIComponent(addUserId)}`, {
        method: "PUT",
        headers: { "x-department-id": department.id, "x-csrf-token": csrfToken, "content-type": "application/json" },
        body: JSON.stringify({ role: "member", permissions: [], modulePermissions: {} }),
      });
      const result = await response.json() as { member?: LocationMember; error?: string };
      if (!response.ok || !result.member) throw new Error(result.error ?? "Could not add location access.");
      setMembers((current) => [...current, result.member!].sort((a, b) => a.displayName.localeCompare(b.displayName)));
      setAvailableUsers((current) => current.filter((user) => user.id !== addUserId));
      setSelectedId(result.member.id); setAddUserId(""); setNotice("Location access added.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add location access."); }
    finally { setSaving(false); }
  }

  async function removeAccess() {
    if (!selected || selected.id === currentUserId) return;
    if (!window.confirm(`Remove ${selected.displayName} from ${department.location}? This only removes access to this location.`)) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/location-access/${encodeURIComponent(selected.id)}`, {
        method: "DELETE",
        headers: { "x-department-id": department.id, "x-csrf-token": csrfToken },
      });
      const result = await response.json() as { id?: string; error?: string };
      if (!response.ok || result.id !== selected.id) throw new Error(result.error ?? "Could not remove location access.");
      const removed = selected;
      setMembers((current) => current.filter((member) => member.id !== removed.id));
      setAvailableUsers((current) => [...current, { id: removed.id, displayName: removed.displayName, username: removed.username }].sort((a, b) => a.displayName.localeCompare(b.displayName)));
      setSelectedId(members.find((member) => member.id !== removed.id)?.id ?? ""); setNotice("Location access removed.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not remove location access."); }
    finally { setSaving(false); }
  }

  function toggle<T extends string>(value: T, current: T[], update: (values: T[]) => void) {
    update(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  return <div className={embedded ? "location-access-embedded" : "modal-backdrop location-access-backdrop"} role={embedded ? undefined : "presentation"} onMouseDown={!embedded ? (event) => event.target === event.currentTarget && onClose() : undefined}>
    <section className={`modal location-access-modal ${embedded ? "location-access-embedded-panel" : ""}`} role={embedded ? "region" : "dialog"} aria-modal={embedded ? undefined : true} aria-labelledby="location-access-title">
      <div className="modal-heading"><div><span className="eyebrow">LOCATION MANAGEMENT</span><h2 id="location-access-title">People &amp; access</h2><p>Manage who can use {department.location} and what each person can do.</p></div><button className="icon-button" type="button" aria-label="Close dialog" onClick={onClose}><X size={19} /></button></div>
      <div className="location-access-layout">
        <aside className="location-access-list" aria-label={`${department.location} members`}>
          {availableUsers.length > 0 && <div className="location-access-add"><label htmlFor="location-access-add">Add an existing account</label><select id="location-access-add" value={addUserId} onChange={(event) => setAddUserId(event.target.value)}><option value="">Choose a user</option>{availableUsers.map((user) => <option value={user.id} key={user.id}>{user.displayName} (@{user.username})</option>)}</select><button className="button button-secondary" type="button" disabled={!addUserId || saving} onClick={() => void addUser()}><Plus size={15} />Add access</button></div>}
          {loading ? <p className="user-access-empty" role="status">Loading people…</p> : members.length === 0 ? <p className="user-access-empty">No people have access to this location.</p> : members.map((member) => <button className={`user-access-item ${member.id === selectedId ? "user-access-item-active" : ""}`} type="button" key={member.id} onClick={() => { setSelectedId(member.id); setError(""); setNotice(""); }}><strong>{member.displayName}{member.id === currentUserId ? " (you)" : ""}</strong><small>@{member.username}</small><span>{member.role === "site_admin" ? "Site administrator" : "Member"}</span></button>)}
          {!loading && availableUsers.length === 0 && <p className="location-access-hint">New accounts are created by a Server Administrator in User access.</p>}
        </aside>
        <form className="location-access-form" onSubmit={save}>
          {selected ? <>
            <div className="user-access-form-heading"><h3>{selected.displayName}</h3><p>Access changes apply only to {department.location}. Server-wide account settings are managed separately.</p></div>
            <label className="location-access-role">Location role<select value={role} onChange={(event) => setRole(event.target.value as LocationMember["role"])}><option value="member">Member</option><option value="site_admin">Site administrator</option></select></label>
            {role === "site_admin" ? <p className="location-access-inherited">Site administrators have all location rights and module rights.</p> : <>
              <fieldset className="module-rights-fieldset"><legend>Location rights</legend>{locationRights.map((right) => <label className="module-right-option" key={right.value}><input type="checkbox" checked={permissions.includes(right.value)} onChange={() => toggle(right.value, permissions, setPermissions)} /><span><strong>{right.label}</strong><small>{right.description}</small></span></label>)}</fieldset>
              {enabledAccessModules.map((module) => <fieldset className="module-rights-fieldset" key={module.id}><legend>{module.accessLabel ?? module.name}</legend>{module.accessLevels!.map((level) => <label className="module-right-option" key={level.value}><input type="checkbox" checked={(modulePermissions[module.id] ?? []).includes(level.value)} onChange={() => setModulePermissions((current) => ({ ...current, [module.id]: (current[module.id] ?? []).includes(level.value) ? current[module.id].filter((value) => value !== level.value) : [...(current[module.id] ?? []), level.value] }))} /><span><strong>{level.label}</strong>{level.description && <small>{level.description}</small>}</span></label>)}</fieldset>)}
            </>}
            {error && <p className="user-access-feedback user-access-feedback-error" role="alert">{error}</p>}{notice && <p className="user-access-feedback" role="status">{notice}</p>}
            <div className="form-actions"><button className="button button-danger" type="button" disabled={saving || selected.id === currentUserId} title={selected.id === currentUserId ? "Ask another site administrator to remove your access." : undefined} onClick={() => void removeAccess()}><Trash2 size={15} />Remove location access</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Saving…" : <><Check size={15} />Save access</>}</button></div>
            <p className="modal-demo-footnote">Removing access preserves the account and all access to other locations. At least one site administrator must remain.</p>
          </> : <div className="location-access-empty"><UsersRound size={22} /><strong>Select a person</strong><p>Choose someone with access to manage their role, or add an existing account.</p></div>}
          {error && !selected && <p className="user-access-feedback user-access-feedback-error" role="alert">{error}</p>}
        </form>
      </div>
    </section>
  </div>;
}
