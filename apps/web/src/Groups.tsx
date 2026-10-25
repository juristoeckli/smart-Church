import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, ContactRound, Pencil, Plus, Search, Trash2, UsersRound, X } from "lucide-react";
import type { ChurchGroup, Contact } from "@smart-church/contracts";

export function Groups({ departmentId, contacts, canManage }: { departmentId: string; contacts: Contact[]; canManage: boolean }) {
  const [groups, setGroups] = useState<ChurchGroup[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [memberDraft, setMemberDraft] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const selected = groups.find((group) => group.id === selectedId) ?? null;

  async function loadGroups(signal?: AbortSignal) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/groups", { headers: { "x-department-id": departmentId }, signal });
      const result = await response.json() as ChurchGroup[] | { error?: string };
      if (!response.ok || !Array.isArray(result)) throw new Error(!Array.isArray(result) ? result.error ?? "Could not load groups." : "Could not load groups.");
      setGroups(result);
      setSelectedId((current) => result.some((group) => group.id === current) ? current : result[0]?.id ?? "");
    } catch (reason) { if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "Could not load groups."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadGroups(controller.signal);
    return () => controller.abort();
  }, [departmentId]);

  useEffect(() => {
    if (!selected) { setName(""); setDescription(""); setMemberDraft([]); setEditing(false); return; }
    setName(selected.name);
    setDescription(selected.description);
    setMemberDraft(selected.memberIds);
    setEditing(false);
  }, [selectedId, selected?.name, selected?.description, selected?.memberIds.join(",")]);

  const visibleContacts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return contacts.filter((contact) => !normalized || `${contact.firstName} ${contact.lastName}`.toLocaleLowerCase().includes(normalized));
  }, [contacts, query]);

  async function saveGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(editing && selected ? `/api/groups/${selected.id}` : "/api/groups", {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json", "x-department-id": departmentId },
        body: JSON.stringify({ name, description }),
      });
      const result = await response.json() as ChurchGroup | { error?: string };
      if (!response.ok || !("id" in result)) throw new Error("error" in result ? result.error ?? "Could not save the group." : "Could not save the group.");
      if (editing) setGroups((current) => current.map((group) => group.id === result.id ? result : group));
      else { setGroups((current) => [...current, result].sort((a, b) => a.name.localeCompare(b.name))); setSelectedId(result.id); }
      setEditing(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the group."); }
    finally { setSaving(false); }
  }

  async function saveMembers() {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/groups/${selected.id}/members`, {
        method: "PUT", headers: { "content-type": "application/json", "x-department-id": departmentId }, body: JSON.stringify({ contactIds: memberDraft }),
      });
      const result = await response.json() as { memberIds?: string[]; error?: string };
      if (!response.ok || !result.memberIds) throw new Error(result.error ?? "Could not save group members.");
      setGroups((current) => current.map((group) => group.id === selected.id ? { ...group, memberIds: result.memberIds!, memberCount: result.memberIds!.length } : group));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save group members."); }
    finally { setSaving(false); }
  }

  async function deleteGroup(group: ChurchGroup) {
    if (!window.confirm(`Delete the group “${group.name}”? People in the group will remain in the directory.`)) return;
    try {
      const response = await fetch(`/api/groups/${group.id}`, { method: "DELETE", headers: { "x-department-id": departmentId } });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not delete the group.");
      setGroups((current) => current.filter((item) => item.id !== group.id));
      if (selectedId === group.id) setSelectedId(groups.find((item) => item.id !== group.id)?.id ?? "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete the group."); }
  }

  return <>
    <div className={`demo-notice ${error ? "demo-notice-error" : ""}`}><span className="demo-dot" />{error || `Groups help people connect at ${departmentId ? "your church" : "this site"}`}{error && <button className="event-retry" type="button" onClick={() => void loadGroups()}>Try again</button>}</div>
    <section className="page-heading"><div><div className="eyebrow">CHURCH COMMUNITY</div><h1>Groups</h1><p className="page-subtitle">Organize congregations and communities, such as the regular service, youth church, and other groups.</p></div>{canManage && <button className="button button-primary" type="button" onClick={() => { setSelectedId(""); setName(""); setDescription(""); setEditing(false); }}><Plus size={17} /> New group</button>}</section>
    <section className="community-groups-layout">
      <section className="directory-card community-group-list"><div className="directory-heading"><div><h2>Church groups</h2><p>{groups.length} {groups.length === 1 ? "group" : "groups"}</p></div></div>
        {loading ? <p className="community-empty">Loading groups…</p> : groups.length ? <div className="community-group-options">{groups.map((group) => <button type="button" key={group.id} className={`community-group-option${selectedId === group.id ? " is-active" : ""}`} onClick={() => setSelectedId(group.id)}><span className="community-group-icon"><ContactRound size={17} /></span><span><strong>{group.name}</strong><small>{group.memberCount} {group.memberCount === 1 ? "person" : "people"}</small></span></button>)}</div> : <p className="community-empty">No groups yet. Create one to get started.</p>}
      </section>
      <section className="directory-card community-group-detail">
        {selected ? <>
          <div className="directory-heading"><div><h2>{selected.name}</h2><p>{selected.importedFrom === "churchtools" ? "Imported from ChurchTools · read-only" : selected.description || "Add a short description for this group."}</p></div>{canManage && !selected.importedFrom && <div className="community-inline-actions"><button className="button button-secondary" type="button" onClick={() => setEditing((current) => !current)}><Pencil size={14} />{editing ? "Cancel edit" : "Edit group"}</button><button className="button button-danger" type="button" onClick={() => void deleteGroup(selected)}><Trash2 size={14} />Delete</button></div>}</div>
          {canManage && editing && <form className="community-group-form" onSubmit={saveGroup}><label>Group name<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label><label>Description<textarea rows={2} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} /></label><button className="button button-primary" type="submit" disabled={saving}><Check size={15} />Save group</button></form>}
          <div className="community-members-heading"><div><h3>Group members</h3><p>{selected.memberCount} people{selected.importedFrom === "churchtools" ? " · managed in ChurchTools" : ""}</p></div>{canManage && !selected.importedFrom && <button className="button button-primary" type="button" disabled={saving || memberDraft.length === selected.memberIds.length && memberDraft.every((id) => selected.memberIds.includes(id))} onClick={() => void saveMembers()}><Check size={15} />Save members</button>}</div>
          {canManage && !selected.importedFrom && <label className="search-field community-member-search"><Search size={15} /><input aria-label="Search people to add to group" placeholder="Search people…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>}
          {selected.importedFrom ? <p className="community-empty">Membership details for imported groups are managed in ChurchTools.</p> : contacts.length ? <div className="community-member-list">{visibleContacts.map((person) => <label className="community-member-row" key={person.id}><input type="checkbox" checked={memberDraft.includes(person.id)} disabled={!canManage} onChange={(event) => setMemberDraft((current) => event.target.checked ? [...current, person.id] : current.filter((id) => id !== person.id))} /><span className="community-member-avatar">{person.firstName[0]}{person.lastName[0]}</span><span><strong>{person.firstName} {person.lastName}</strong><small>{person.status === "member" ? "Member" : "Visitor"}</small></span></label>)}</div> : <p className="community-empty">Add people in the People section before assigning group members.</p>}
        </> : canManage ? <form className="community-new-group" onSubmit={saveGroup}><span className="community-group-icon"><ContactRound size={20} /></span><h2>Create a group</h2><p>Give the group a name, then add people from your directory.</p><label>Group name<input autoFocus required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Regular service or Youth church" /></label><label>Description <span className="optional-label">Optional</span><textarea rows={3} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Who belongs to this group?" /></label><button className="button button-primary" type="submit" disabled={saving || !name.trim()}><Plus size={16} />Create group</button></form> : <p className="community-empty">Select a group to see its members.</p>}
      </section>
    </section>
    <footer className="page-footer"><span>Every person has a place to belong.</span><span>© 2026 Smart Church</span></footer>
  </>;
}
