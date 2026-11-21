import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ModuleContext } from "../../module-registry";
import "./styles.css";

type Group = { id: string; name: string; description: string; parentId: string | null; memberCount: number; activeCount: number; subgroupCount: number; imported: boolean };
type Member = { contactId: string; firstName: string; lastName: string; email: string | null; role: string; status: "active" | "paused" | "waitlist"; joinedOn: string | null; customFields: Record<string, string | number | boolean | null> };
type History = { id: string; entityKind: string; entityId: string; action: string; beforeData: unknown; afterData: unknown; createdAt: string; actorName: string };
type Leader = { groupId: string; groupName: string; groupDescription: string; parentGroupName: string | null; contactId: string; firstName: string; lastName: string; email: string | null; role: string; joinedOn: string | null };
type GroupNote = { id: string; title: string; body: string; createdAt: string; updatedAt: string; authorName: string; canArchive: boolean };
type GroupInvitation = { id: string; contactId: string; firstName: string; lastName: string; createdAt: string; expiresAt: string; acceptedAt: string | null; revokedAt: string | null; status: "pending" | "accepted" | "revoked" | "expired" };

function historyRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function membershipChanges(entry: History) {
  const before = historyRecord(entry.beforeData);
  const after = historyRecord(entry.afterData);
  const fields = [
    { label: "Role", before: before.role, after: after.role },
    { label: "Status", before: before.status, after: after.status },
    { label: "Join date", before: before.joinedOn ?? before.joined_on, after: after.joinedOn ?? after.joined_on },
  ];
  const beforeCustom = historyRecord(before.customFields);
  const afterCustom = historyRecord(after.customFields);
  for (const key of new Set([...Object.keys(beforeCustom), ...Object.keys(afterCustom)])) {
    fields.push({ label: key, before: beforeCustom[key], after: afterCustom[key] });
  }
  return fields.filter((field) => (field.before ?? null) !== (field.after ?? null));
}

export function GroupHierarchyModule({ departmentId, csrfToken, language }: ModuleContext) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberRole, setMemberRole] = useState("");
  const [memberStatus, setMemberStatus] = useState("");
  const [memberSort, setMemberSort] = useState<"name" | "role" | "joined">("name");
  const [rosterScope, setRosterScope] = useState("");
  const [bulkSelection, setBulkSelection] = useState<{ scope: string; ids: string[] }>({ scope: "", ids: [] });
  const [bulkRole, setBulkRole] = useState("");
  const [bulkStatus, setBulkStatus] = useState<"" | Member["status"]>("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [history, setHistory] = useState<History[]>([]);
  const [membershipHistoryOnly, setMembershipHistoryOnly] = useState(false);
  const [notes, setNotes] = useState<GroupNote[]>([]);
  const [canManageNotes, setCanManageNotes] = useState(false);
  const [noteDraft, setNoteDraft] = useState({ title: "", body: "" });
  const [rules, setRules] = useState<Array<{ contactStatus: "member" | "visitor"; enabled: boolean }>>([]);
  const [parentId, setParentId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [inviteContactId, setInviteContactId] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [invitations, setInvitations] = useState<GroupInvitation[]>([]);
  const [canManageInvitations, setCanManageInvitations] = useState(false);
  const [inviteToken, setInviteToken] = useState(() => new URLSearchParams(window.location.search).get("groupInvite") ?? "");
  const [edit, setEdit] = useState<Member | null>(null);
  const [customText, setCustomText] = useState("{}");
  const [leaders, setLeaders] = useState<Leader[] | null>(null);
  const selected = groups.find((group) => group.id === selectedId) ?? null;
  const groupScope = `${departmentId}:${selectedId}`;
  const currentRoster = rosterScope === groupScope ? members : [];
  const memberRoles = [...new Set(currentRoster.map((member) => member.role))].filter(Boolean).sort((a, b) => a.localeCompare(b, language));
  const memberSearch = memberQuery.trim().toLocaleLowerCase(language);
  const compareNames = (a: Member, b: Member) =>
    a.lastName.localeCompare(b.lastName, language) || a.firstName.localeCompare(b.firstName, language) || a.contactId.localeCompare(b.contactId);
  const visibleMembers = currentRoster.filter((member) =>
    (!memberRole || member.role === memberRole) &&
    (!memberStatus || member.status === memberStatus) &&
    (!memberSearch || `${member.firstName} ${member.lastName} ${member.email ?? ""}`.toLocaleLowerCase(language).includes(memberSearch))
  ).sort((a, b) => {
    if (memberSort === "role") return a.role.localeCompare(b.role, language) || compareNames(a, b);
    if (memberSort === "joined") return (b.joinedOn ?? "").localeCompare(a.joinedOn ?? "") || compareNames(a, b);
    return compareNames(a, b);
  });
  const canBulkEdit = Boolean(selected && !selected.imported && rosterScope === groupScope && canManageNotes);
  const bulkIds = bulkSelection.scope === groupScope ? bulkSelection.ids.filter((id) => visibleMembers.some((member) => member.contactId === id)) : [];
  useEffect(() => {
    setBulkSelection({ scope: "", ids: [] });
    setBulkRole("");
    setBulkStatus("");
    setMemberQuery("");
    setMemberRole("");
    setMemberStatus("");
  }, [groupScope]);
  const headers = useMemo(() => ({ "x-department-id": departmentId }), [departmentId]);
  const load = useCallback(async () => {
    setError("");
    const response = await fetch("/api/modules/group-hierarchy/tree", { headers });
    if (!response.ok) throw new Error("Could not load groups.");
    const data = await response.json() as Group[];
    setGroups(data);
    setSelectedId((current) => data.some((group) => group.id === current) ? current : data[0]?.id ?? "");
  }, [headers]);
  const loadDetails = useCallback(async (id: string) => {
    if (!id) { setMembers([]); setHistory([]); setNotes([]); setCanManageNotes(false); setInvitations([]); setCanManageInvitations(false); return; }
    const [memberResponse, historyResponse, ruleResponse, noteResponse, invitationResponse] = await Promise.all([
      fetch(`/api/modules/group-hierarchy/groups/${id}/members`, { headers }),
      fetch(`/api/modules/group-hierarchy/groups/${id}/history${membershipHistoryOnly ? "?entityKind=membership" : ""}`, { headers }),
      fetch(`/api/modules/group-hierarchy/groups/${id}/membership-rules`, { headers }),
      fetch(`/api/modules/group-hierarchy/groups/${id}/notes`, { headers }),
      fetch(`/api/modules/group-hierarchy/groups/${id}/invitations`, { headers }),
    ]);
    if (!memberResponse.ok || !historyResponse.ok || !ruleResponse.ok || !noteResponse.ok || !invitationResponse.ok) throw new Error("Could not load group details.");
    const roster = await memberResponse.json() as Member[];
    setMembers(roster);
    setRosterScope(`${headers["x-department-id"]}:${id}`);
    setHistory(await historyResponse.json() as History[]);
    setRules(await ruleResponse.json() as Array<{ contactStatus: "member" | "visitor"; enabled: boolean }>);
    const noteData = await noteResponse.json() as { notes: GroupNote[]; canManage: boolean };
    setNotes(noteData.notes);
    setCanManageNotes(noteData.canManage);
    const invitationData = await invitationResponse.json() as { invitations: GroupInvitation[]; canManage: boolean };
    setInvitations(invitationData.invitations);
    setCanManageInvitations(invitationData.canManage);
    setParentId(groups.find((group) => group.id === id)?.parentId ?? "");
  }, [groups, headers, membershipHistoryOnly]);
  useEffect(() => { void load().catch((reason: Error) => setError(reason.message)); }, [load]);
  useEffect(() => { void loadDetails(selectedId).catch((reason: Error) => setError(reason.message)); }, [loadDetails, selectedId]);
  const mutate = async (path: string, method: string, body: unknown) => {
    setError(""); setMessage("");
    const response = await fetch(path, { method, headers: { ...headers, "x-csrf-token": csrfToken, "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(result?.error ?? "The request could not be completed.");
    return result;
  };
  const saveParent = async () => { try { await mutate(`/api/modules/group-hierarchy/groups/${selectedId}/parent`, "PUT", { parentId: parentId || null }); await load(); setMessage("Group hierarchy saved."); } catch (reason) { setError((reason as Error).message); } };
  const saveRules = async () => { try { await mutate(`/api/modules/group-hierarchy/groups/${selectedId}/membership-rules`, "PUT", { rules }); await loadDetails(selectedId); setMessage("Automatic membership rules saved."); } catch (reason) { setError((reason as Error).message); } };
  const addNote = async () => {
    try { await mutate(`/api/modules/group-hierarchy/groups/${selectedId}/notes`, "POST", noteDraft); setNoteDraft({ title: "", body: "" }); await loadDetails(selectedId); setMessage("Group note added."); }
    catch (reason) { setError((reason as Error).message); }
  };
  const archiveNote = async (note: GroupNote) => {
    if (!window.confirm(`Archive “${note.title}”?`)) return;
    try { await mutate(`/api/modules/group-hierarchy/groups/${selectedId}/notes/${note.id}`, "DELETE", {}); await loadDetails(selectedId); setMessage("Group note archived."); }
    catch (reason) { setError((reason as Error).message); }
  };
  const saveMember = async () => {
    if (!edit) return;
    try {
      const customFields = JSON.parse(customText) as Record<string, unknown>;
      await mutate(`/api/modules/group-hierarchy/groups/${selectedId}/members/${edit.contactId}`, "PUT", { role: edit.role, status: edit.status, joinedOn: edit.joinedOn || null, customFields });
      setEdit(null); await loadDetails(selectedId); setMessage("Membership saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Custom fields must be valid JSON."); }
  };
  const saveBulkMembers = async () => {
    if (!canBulkEdit || bulkSaving || !bulkIds.length || (!bulkRole.trim() && !bulkStatus)) return;
    if (!window.confirm(`Update ${bulkIds.length} selected memberships?`)) return;
    setBulkSaving(true);
    try {
      await mutate(`/api/modules/group-hierarchy/groups/${selectedId}/members`, "PATCH", {
        contactIds: bulkIds,
        ...(bulkRole.trim() ? { role: bulkRole.trim() } : {}),
        ...(bulkStatus ? { status: bulkStatus } : {}),
      });
      setBulkSelection({ scope: "", ids: [] });
      await loadDetails(selectedId);
      setMessage("Selected memberships updated.");
    } catch (reason) { setError((reason as Error).message); }
    finally { setBulkSaving(false); }
  };
  const sendInvite = async () => {
    try { const result = await mutate(`/api/modules/group-hierarchy/groups/${selectedId}/invitations`, "POST", { contactId: inviteContactId }) as { invitationToken: string };
      setInviteLink(`${window.location.origin}/?groupInvite=${result.invitationToken}`); await loadDetails(selectedId); setMessage("Invitation created. The invited person can sign in and accept it from this group administration page.");
    } catch (reason) { setError((reason as Error).message); }
  };
  const revokeInvite = async (invitation: GroupInvitation) => {
    if (!window.confirm(`Revoke the invitation for ${invitation.firstName} ${invitation.lastName}?`)) return;
    try { await mutate(`/api/modules/group-hierarchy/groups/${selectedId}/invitations/${invitation.id}`, "DELETE", {}); await loadDetails(selectedId); setMessage("Invitation revoked."); }
    catch (reason) { setError((reason as Error).message); }
  };
  const acceptInvite = async () => {
    try { await mutate(`/api/modules/group-hierarchy/invitations/${inviteToken}/accept`, "POST", {}); setInviteToken(""); setMessage("Invitation accepted. You are now a group member."); await load(); }
    catch (reason) { setError((reason as Error).message); }
  };
  const loadLeaders = async () => {
    setError("");
    try {
      const response = await fetch("/api/modules/group-hierarchy/leaders", { headers });
      const result = await response.json().catch(() => null) as Leader[] | { error?: string } | null;
      if (!response.ok) throw new Error((result as { error?: string } | null)?.error ?? "Could not load group leaders.");
      setLeaders(result as Leader[]);
    } catch (reason) { setError((reason as Error).message); }
  };
  const exportLeaders = () => {
    if (!leaders) return;
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [["Group", "Parent group", "Description", "Leader", "Email", "Role", "Joined on"], ...leaders.map((leader) => [leader.groupName, leader.parentGroupName, leader.groupDescription, `${leader.firstName} ${leader.lastName}`.trim(), leader.email, leader.role, leader.joinedOn])].map((row) => row.map(escape).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "group-leadership.csv"; anchor.click(); URL.revokeObjectURL(url);
  };
  const renderTree = (parent: string | null, depth = 0): ReactNode => groups.filter((group) => group.parentId === parent).map((group) => <div key={group.id}>
    <button className={`gh-tree-row ${selectedId === group.id ? "selected" : ""}`} style={{ paddingInlineStart: `${12 + depth * 20}px` }} onClick={() => setSelectedId(group.id)}>
      <span>{group.name}</span><small>{group.activeCount}/{group.memberCount} · {group.subgroupCount} subgroups</small>
    </button>{renderTree(group.id, depth + 1)}
  </div>);
  const text = language === "de" ? { title: "Gruppenverwaltung", intro: "Untergruppen, Rollen, Mitgliedschaften und Gruppenverlauf verwalten.", groups: "Gruppen", members: "Mitglieder", history: "Verlauf", empty: "Keine Gruppen an diesem Standort." } : language === "fr" ? { title: "Gestion des groupes", intro: "Gérez les sous-groupes, les rôles, les adhésions et l’historique.", groups: "Groupes", members: "Membres", history: "Historique", empty: "Aucun groupe pour ce lieu." } : { title: "Group administration", intro: "Manage subgroups, roles, memberships, and group history.", groups: "Groups", members: "Members", history: "History", empty: "No groups at this location." };
  return <main className="page-wrap-group-hierarchy">
    <header className="gh-header"><div><p className="eyebrow">{text.groups.toUpperCase()}</p><h1>{text.title}</h1><p>{text.intro}</p></div><button onClick={() => void load().catch((reason: Error) => setError(reason.message))}>Refresh</button></header>
    {error && <p role="alert" className="gh-alert">{error}</p>}{message && <p role="status" className="gh-message">{message}</p>}
    {inviteToken && <section className="gh-panel gh-accept-invite"><h2>Group invitation</h2><p>Sign in with the account linked to the invited person, then accept the invitation.</p><code>{inviteToken}</code><button onClick={() => void acceptInvite()}>Accept invitation</button></section>}
    <div className="gh-panel gh-leadership-actions"><div><h2>Group leadership</h2><p>Active leaders and co-leaders across groups at this location.</p></div><button onClick={() => void loadLeaders()}>{leaders ? "Refresh leadership" : "Load leadership report"}</button>{leaders && <button onClick={exportLeaders}>Export CSV</button>}</div>
    {leaders && <section className="gh-panel gh-leadership"><h2>Leadership roster <small>({leaders.length})</small></h2>{leaders.length ? <div className="gh-member-list">{leaders.map((leader) => <article className="gh-member" key={`${leader.groupId}:${leader.contactId}`}><div><strong>{leader.firstName} {leader.lastName} · {leader.groupName}</strong><small>{leader.parentGroupName ? `${leader.parentGroupName} · ` : ""}{leader.email ?? "Email hidden · private People access required"} · {leader.role} · {leader.joinedOn ? `Since ${leader.joinedOn.slice(0, 10)}` : "Join date unavailable"}</small></div></article>)}</div> : <p>No active group leaders were found.</p>}</section>}
    <div className="gh-layout"><aside className="gh-panel"><h2>{text.groups}</h2>{groups.length ? renderTree(null) : <p>{text.empty}</p>}</aside>
      <section className="gh-content">{selected ? <>
        <div className="gh-panel gh-hierarchy"><h2>{selected.name}</h2><p>{selected.description || "No description"}{selected.imported ? " · Managed by external sync" : ""}</p>
          <label>Parent group<select value={parentId} disabled={selected.imported} onChange={(event) => setParentId(event.target.value)}><option value="">No parent</option>{groups.filter((group) => group.id !== selected.id).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
          <button disabled={selected.imported} onClick={() => void saveParent()}>Save hierarchy</button>
        </div>
        <div className="gh-panel"><h2>{text.members} <small>({visibleMembers.length}/{currentRoster.length})</small></h2>
          <div className="gh-actions">
            <label>Search members<input type="search" value={memberQuery} onChange={(event) => { setMemberQuery(event.target.value); setBulkSelection({ scope: "", ids: [] }); }} /></label>
            <label>Filter by role<select value={memberRole} onChange={(event) => { setMemberRole(event.target.value); setBulkSelection({ scope: "", ids: [] }); }}>
              <option value="">All roles</option>{memberRoles.map((role) => <option key={role} value={role}>{role}</option>)}
            </select></label>
            <label>Filter by status<select value={memberStatus} onChange={(event) => { setMemberStatus(event.target.value); setBulkSelection({ scope: "", ids: [] }); }}>
              <option value="">All statuses</option><option value="active">Active</option><option value="paused">Paused</option><option value="waitlist">Waitlist</option>
            </select></label>
            <label>Sort members<select value={memberSort} onChange={(event) => setMemberSort(event.target.value as typeof memberSort)}>
              <option value="name">Last name</option><option value="role">Role</option><option value="joined">Newest join date</option>
            </select></label>
          </div>
          {canBulkEdit && <section aria-label="Bulk membership editing">
            <label>Role<input value={bulkRole} maxLength={80} placeholder="Keep current role" disabled={bulkSaving} onChange={(event) => setBulkRole(event.target.value)} /></label>
            <label>Status<select value={bulkStatus} disabled={bulkSaving} onChange={(event) => setBulkStatus(event.target.value as "" | Member["status"])}>
              <option value="">Keep current status</option><option value="active">Active</option><option value="paused">Paused</option><option value="waitlist">Waitlist</option>
            </select></label>
            <button type="button" disabled={bulkSaving || !bulkIds.length || (!bulkRole.trim() && !bulkStatus)} onClick={() => void saveBulkMembers()}>
              {bulkSaving ? "Updating…" : `Update selected (${bulkIds.length}/100)`}
            </button>
          </section>}
          {rosterScope === groupScope && visibleMembers.length === 0 && <p>{currentRoster.length ? "No members match these filters." : "No members in this group."}</p>}
          <div className="gh-member-list">{visibleMembers.map((member) => <article key={member.contactId} className="gh-member">
            {canBulkEdit && <input type="checkbox" aria-label={`Select ${member.firstName} ${member.lastName}`} checked={bulkIds.includes(member.contactId)}
              disabled={bulkSaving || (bulkIds.length >= 100 && !bulkIds.includes(member.contactId))}
              onChange={(event) => setBulkSelection({ scope: groupScope, ids: event.target.checked ? [...bulkIds, member.contactId] : bulkIds.filter((id) => id !== member.contactId) })} />}
            <div><strong>{member.firstName} {member.lastName}</strong><small>{member.email || ""} · {member.role} · {member.status}</small></div>
            <button disabled={selected.imported} onClick={() => { setEdit(member); setCustomText(JSON.stringify(member.customFields, null, 2)); }}>Edit</button>
          </article>)}</div>
          <div className="gh-invite"><label>Invite existing person by contact ID<input value={inviteContactId} onChange={(event) => setInviteContactId(event.target.value)} placeholder="Contact UUID" /></label><button disabled={!inviteContactId || selected.imported} onClick={() => void sendInvite()}>Create invitation</button>{inviteLink && <input readOnly value={inviteLink} onFocus={(event) => event.currentTarget.select()} />}</div>
          {canManageInvitations && <section className="gh-invitations"><h3>Invitation history <small>({invitations.length})</small></h3>{invitations.length ? <div className="gh-member-list">{invitations.map((invitation) => <article className="gh-member" key={invitation.id}><div><strong>{invitation.firstName} {invitation.lastName}</strong><small>{invitation.status} · Created {new Date(invitation.createdAt).toLocaleString()} · Expires {new Date(invitation.expiresAt).toLocaleDateString()}</small></div>{invitation.status === "pending" && <button onClick={() => void revokeInvite(invitation)}>Revoke</button>}</article>)}</div> : <p>No invitations have been created for this group.</p>}</section>}
        </div>
        <div className="gh-panel"><h2>Automatic membership</h2><p>Rules affect future people and only remove memberships created by these rules.</p>{(["member", "visitor"] as const).map((status) => <label className="gh-check" key={status}><input type="checkbox" checked={rules.some((rule) => rule.contactStatus === status && rule.enabled)} onChange={(event) => setRules((current) => [...current.filter((rule) => rule.contactStatus !== status), ...(event.target.checked ? [{ contactStatus: status, enabled: true }] : [])])} /> Automatically add {status}s</label>)}<button disabled={selected.imported} onClick={() => void saveRules()}>Save rules</button></div>
        <div className="gh-panel"><h2>Group notes <small>({notes.length})</small></h2><p>Notes are visible to this group’s leaders and group managers.</p>
          {canManageNotes && <form className="gh-note-form" onSubmit={(event) => { event.preventDefault(); void addNote(); }}><label>Title<input required maxLength={160} value={noteDraft.title} onChange={(event) => setNoteDraft({ ...noteDraft, title: event.target.value })} /></label><label>Note<textarea required maxLength={10000} rows={4} value={noteDraft.body} onChange={(event) => setNoteDraft({ ...noteDraft, body: event.target.value })} /></label><button disabled={!noteDraft.title.trim() || !noteDraft.body.trim()}>Add note</button></form>}
          {notes.length ? notes.map((note) => <article className="gh-history" key={note.id}><strong>{note.title}</strong><small>{note.authorName} · {new Date(note.createdAt).toLocaleString()}</small><p className="gh-note-body">{note.body}</p>{note.canArchive && <button className="gh-note-archive" onClick={() => void archiveNote(note)}>Archive note</button>}</article>) : <p>No group notes yet.</p>}
        </div>
        <div className="gh-panel">
          <h2>{text.history}</h2>
          <label className="gh-check"><input type="checkbox" checked={membershipHistoryOnly} onChange={(event) => setMembershipHistoryOnly(event.target.checked)} /> Membership changes only</label>
          {history.filter((entry) => !membershipHistoryOnly || entry.entityKind === "membership").map((entry) => {
            const member = entry.entityKind === "membership" ? members.find((person) => person.contactId === entry.entityId) : undefined;
            const changes = entry.entityKind === "membership" ? membershipChanges(entry) : [];
            return <article className="gh-history" key={entry.id}>
              <strong>{entry.entityKind} {entry.action}{member ? ` · ${member.firstName} ${member.lastName}` : ""}</strong>
              <small>{new Date(entry.createdAt).toLocaleString()} · {entry.actorName}</small>
              {changes.length > 0 && <ul>{changes.map((field, index) => <li key={index}><strong>{field.label}:</strong> {String(field.before ?? "—")} → {String(field.after ?? "—")}</li>)}</ul>}
              <details><summary>Change details</summary><pre>{JSON.stringify({ before: entry.beforeData, after: entry.afterData }, null, 2)}</pre></details>
            </article>;
          })}
          {!history.some((entry) => !membershipHistoryOnly || entry.entityKind === "membership") && <p>No recorded changes yet.</p>}
        </div>
      </> : <div className="gh-panel"><p>{text.empty}</p></div>}</section></div>
    {edit && <div className="gh-modal-backdrop" role="presentation"><section className="gh-modal" role="dialog" aria-modal="true" aria-labelledby="gh-edit-title"><h2 id="gh-edit-title">Edit membership · {edit.firstName} {edit.lastName}</h2><label>Role<input value={edit.role} onChange={(event) => setEdit({ ...edit, role: event.target.value })} /></label><label>Status<select value={edit.status} onChange={(event) => setEdit({ ...edit, status: event.target.value as Member["status"] })}><option value="active">Active</option><option value="paused">Paused</option><option value="waitlist">Waitlist</option></select></label><label>Joined on<input type="date" value={edit.joinedOn?.slice(0, 10) ?? ""} onChange={(event) => setEdit({ ...edit, joinedOn: event.target.value || null })} /></label><label>Custom fields (JSON)<textarea rows={7} value={customText} onChange={(event) => setCustomText(event.target.value)} /></label><div className="gh-actions"><button onClick={() => setEdit(null)}>Cancel</button><button onClick={() => void saveMember()}>Save membership</button></div></section></div>}
  </main>;
}
