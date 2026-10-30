import { useEffect, useState, type FormEvent } from "react";
import { Check, X } from "lucide-react";
import type { ModuleRegistration } from "./module-registry";

type SignupRequest = { id: string; email: string; firstName: string; lastName: string; phone: string; street: string; streetNumber: string; postalCode: string; city: string; username: string; status: "pending_admin" | "approved_delivery_failed"; createdAt: string; lastError: string | null };
type Site = { id: string; name: string; enabledModules?: string[] };
type Draft = Omit<SignupRequest, "id" | "email" | "status" | "createdAt" | "lastError"> & { role: "member" | "site_admin"; permissions: string[]; videoPermissions: string[]; presenterPermissions: string[]; modulePermissions: Record<string, string[]> };
const permissionOptions = [
  ["people_view_private", "View private contact details"], ["people_manage", "Manage people"],
  ["events_manage", "Manage services and events"], ["groups_manage", "Manage groups"], ["resources_manage", "Manage resources"],
] as const;
const videoPermissionOptions = ["video_basic", "streaming_operator", "stream_admin", "routing_user", "routing_admin"] as const;
const presenterPermissionOptions = ["editor", "operator", "admin"] as const;

export function SelfSignupAdmin({ refreshCsrfToken, modules, departmentId, departmentName }: { refreshCsrfToken: () => Promise<string>; modules: ModuleRegistration[]; departmentId: string; departmentName: string }) {
  const [enabled, setEnabled] = useState(false);
  const [delay, setDelay] = useState(11);
  const [requests, setRequests] = useState<SignupRequest[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [feedback, setFeedback] = useState("");

  async function load() {
    const [settingsResponse, queueResponse] = await Promise.all([
      fetch("/api/modules/email-worker/self-signup/settings", { cache: "no-store", headers: { "x-department-id": departmentId } }),
      fetch("/api/modules/email-worker/self-signup/requests", { cache: "no-store", headers: { "x-department-id": departmentId } }),
    ]);
    const settings = await settingsResponse.json() as { enabled?: boolean; confirmationDelayMinutes?: number; error?: string };
    const queue = await queueResponse.json() as { requests?: SignupRequest[]; departments?: Site[]; error?: string };
    if (!settingsResponse.ok) throw new Error(settings.error ?? "Could not load sign-up settings.");
    if (!queueResponse.ok || !Array.isArray(queue.requests)) throw new Error(queue.error ?? "Could not load sign-up requests.");
    setEnabled(settings.enabled ?? false); setDelay(settings.confirmationDelayMinutes ?? 11);
    setRequests(queue.requests); setSites(queue.departments ?? []);
    setDrafts(Object.fromEntries(queue.requests.map((request) => [request.id, {
      firstName: request.firstName, lastName: request.lastName, phone: request.phone, street: request.street,
      streetNumber: request.streetNumber, postalCode: request.postalCode, city: request.city,
      username: request.username || `${request.firstName}.${request.lastName}`.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 32).replace(/^[^a-z0-9]+/, "") || "new.user",
      role: "member" as const, permissions: [], videoPermissions: [], presenterPermissions: [], modulePermissions: {},
    }])));
  }

  useEffect(() => {
    let active = true;
    void load().catch((error: unknown) => { if (active) setFeedback(error instanceof Error ? error.message : "Could not load sign-up settings."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [departmentId]);

  function update(id: string, change: Partial<Draft>) { setDrafts((current) => ({ ...current, [id]: { ...current[id], ...change } })); }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setFeedback("");
    try {
      const csrfToken = await refreshCsrfToken();
      const response = await fetch("/api/modules/email-worker/self-signup/settings", { method: "PUT", headers: { "content-type": "application/json", "x-csrf-token": csrfToken, "x-department-id": departmentId }, body: JSON.stringify({ enabled, confirmationDelayMinutes: delay }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not save sign-up settings.");
      setFeedback("Self sign-up settings saved.");
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Could not save sign-up settings."); }
    finally { setSaving(false); }
  }

  async function review(request: SignupRequest, action: "approve" | "deny" | "retry_login", event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault(); setBusyId(request.id); setFeedback("");
    try {
      const csrfToken = await refreshCsrfToken();
      const draft = drafts[request.id];
      const response = await fetch(`/api/modules/email-worker/self-signup/requests/${request.id}`, {
        method: "PUT", headers: { "content-type": "application/json", "x-csrf-token": csrfToken, "x-department-id": departmentId },
        body: JSON.stringify(action === "approve" ? { action, ...draft } : { action }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not update the sign-up request.");
      await load();
      setFeedback(action === "deny" ? "Sign-up request denied." : action === "retry_login" ? "Login details sent." : "Account approved and login details sent.");
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Could not update the sign-up request."); }
    finally { setBusyId(""); }
  }

  if (loading) return <p className="server-settings-empty">Loading self sign-up settings…</p>;
  return <section className="self-signup-admin">
    <form className="self-signup-config" onSubmit={(event) => void saveSettings(event)}>
      <div className="server-admin-panel-heading"><h3>Self sign-up · {departmentName}</h3><p>Let people request an account for this site. Their email is verified before requests appear for review.</p></div>
      <label className="global-admin-option"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span><strong>{enabled ? "Self sign-up enabled" : "Self sign-up disabled"}</strong><small>Off by default. Email delivery must be configured first.</small></span></label>
      <label className="self-signup-delay">Wait before sending the second confirmation email<input type="number" min={1} max={1440} required value={delay} onChange={(event) => setDelay(Number(event.target.value))} /><small>Minutes, from 1 to 1,440. Default: 11 minutes.</small></label>
      <div className="form-actions"><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save sign-up settings"}</button></div>
    </form>
    <div className="server-admin-panel-heading"><h3>Requests awaiting review</h3><p>{requests.length} {requests.length === 1 ? "request" : "requests"}</p></div>
    {requests.length === 0 ? <p className="server-settings-empty">No verified sign-up requests need review.</p> : <div className="self-signup-request-list">{requests.map((request) => {
      const draft = drafts[request.id];
      if (!draft) return null;
      if (request.status === "approved_delivery_failed") return <article className="self-signup-request" key={request.id}><div className="self-signup-request-heading"><div><strong>{request.email}</strong><small>Account created · login email needs retry</small></div><button className="button button-primary" type="button" disabled={busyId === request.id} onClick={() => void review(request, "retry_login")}>{busyId === request.id ? "Sending…" : "Send login details again"}</button></div>{request.lastError && <p className="user-access-feedback user-access-feedback-error" role="alert">{request.lastError}</p>}</article>;
      return <article className="self-signup-request" key={request.id}><div className="self-signup-request-heading"><div><strong>{request.email}</strong><small>Verified {new Date(request.createdAt).toLocaleString()}</small></div></div><form className="self-signup-review-form" onSubmit={(event) => void review(request, "approve", event)}>
        <label>First name *<input required maxLength={80} value={draft.firstName} onChange={(event) => update(request.id, { firstName: event.target.value })} /></label>
        <label>Last name *<input required maxLength={80} value={draft.lastName} onChange={(event) => update(request.id, { lastName: event.target.value })} /></label>
        <label>Username *<input required minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" value={draft.username} onChange={(event) => update(request.id, { username: event.target.value })} /></label>
        <label>Phone<input maxLength={32} value={draft.phone} onChange={(event) => update(request.id, { phone: event.target.value })} /></label>
        <label>Street<input maxLength={160} value={draft.street} onChange={(event) => update(request.id, { street: event.target.value })} /></label>
        <label>Street number<input maxLength={24} value={draft.streetNumber} onChange={(event) => update(request.id, { streetNumber: event.target.value })} /></label>
        <label>Postal code<input maxLength={20} value={draft.postalCode} onChange={(event) => update(request.id, { postalCode: event.target.value })} /></label>
        <label>City<input maxLength={100} value={draft.city} onChange={(event) => update(request.id, { city: event.target.value })} /></label>
        <label>Site role<select value={draft.role} onChange={(event) => update(request.id, { role: event.target.value as Draft["role"] })}><option value="member">Member</option><option value="site_admin">Site administrator</option></select></label>
        {draft.role === "member" && <fieldset className="self-signup-rights"><legend>Location rights</legend>{permissionOptions.map(([value, label]) => <label key={value}><input type="checkbox" checked={draft.permissions.includes(value)} onChange={(event) => update(request.id, { permissions: event.target.checked ? [...draft.permissions, value] : draft.permissions.filter((permission) => permission !== value) })} />{label}</label>)}</fieldset>}
        {draft.role === "member" && sites.find((site) => site.id === departmentId)?.enabledModules?.includes("video-steffisburg") && <fieldset className="self-signup-rights"><legend>Video rights</legend>{videoPermissionOptions.map((value) => <label key={value}><input type="checkbox" checked={draft.videoPermissions.includes(value)} onChange={(event) => update(request.id, { videoPermissions: event.target.checked ? [...draft.videoPermissions, value] : draft.videoPermissions.filter((permission) => permission !== value) })} />{value.replaceAll("_", " ")}</label>)}</fieldset>}
        {draft.role === "member" && sites.find((site) => site.id === departmentId)?.enabledModules?.includes("presenter") && <fieldset className="self-signup-rights"><legend>Presenter rights</legend>{presenterPermissionOptions.map((value) => <label key={value}><input type="checkbox" checked={draft.presenterPermissions.includes(value)} onChange={(event) => update(request.id, { presenterPermissions: event.target.checked ? [...draft.presenterPermissions, value] : draft.presenterPermissions.filter((permission) => permission !== value) })} />{value}</label>)}</fieldset>}
        {draft.role === "member" && modules.filter((module) => module.id !== "video-steffisburg" && module.id !== "presenter" && module.accessLevels?.length && (module.enabledByDefault || sites.find((site) => site.id === departmentId)?.enabledModules?.includes(module.id))).map((module) => <fieldset className="self-signup-rights" key={module.id}><legend>{module.accessLabel ?? module.name}</legend>{module.accessLevels!.map((level) => <label key={level.value}><input type="checkbox" checked={(draft.modulePermissions[module.id] ?? []).includes(level.value)} onChange={(event) => update(request.id, { modulePermissions: { ...draft.modulePermissions, [module.id]: event.target.checked ? [...(draft.modulePermissions[module.id] ?? []), level.value] : (draft.modulePermissions[module.id] ?? []).filter((permission) => permission !== level.value) } })} /><span>{level.label}{level.description && <small>{level.description}</small>}</span></label>)}</fieldset>)}
        <div className="form-actions"><button className="button button-secondary" type="button" disabled={busyId === request.id} onClick={() => void review(request, "deny") }><X size={15} />Deny</button><button className="button button-primary" type="submit" disabled={busyId === request.id || !sites.length}><Check size={15} />{busyId === request.id ? "Approving…" : "Approve and send login"}</button></div>
      </form></article>;
    })}</div>}
    {feedback && <p className="user-access-feedback" role="status">{feedback}</p>}
  </section>;
}
