import { useEffect, useState, type FormEvent } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import type { ModuleSettingsContext } from "../../module-registry";
import "./remote-desktop-settings.css";

type Protocol = "rdp" | "vnc" | "spice";
type Destination = { id: string; name: string; host: string; port: number; protocol: Protocol; username: string; autologin: boolean; passwordConfigured: boolean };
type DestinationForm = { name: string; host: string; port: string; protocol: Protocol; username: string; password: string; noPassword: boolean; autologin: boolean };
const blankForm: DestinationForm = { name: "", host: "", port: "3389", protocol: "rdp", username: "", password: "", noPassword: false, autologin: true };

async function responseBody<T>(response: Response): Promise<T & { error?: string }> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Could not save remote desktop destination.");
  return body;
}

export function RemoteDesktopSettings({ departmentId, csrfToken, departments }: ModuleSettingsContext) {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [form, setForm] = useState(blankForm);
  const [editingId, setEditingId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackError, setFeedbackError] = useState(false);
  const site = departments.find((item) => item.id === departmentId);

  useEffect(() => {
    if (!departmentId) { setDestinations([]); return; }
    const controller = new AbortController();
    setLoading(true);
    void fetch("/api/modules/remote-desktop/destinations", { headers: { "x-department-id": departmentId }, signal: controller.signal })
      .then((response) => responseBody<Destination[]>(response))
      .then(setDestinations)
      .catch((error: unknown) => { if (!controller.signal.aborted) { setFeedback(error instanceof Error ? error.message : "Could not load destinations."); setFeedbackError(true); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [departmentId]);

  function startAdd() {
    setEditingId("");
    setForm(blankForm);
    setFeedback("");
    setFeedbackError(false);
  }

  function startEdit(destination: Destination) {
    setEditingId(destination.id);
    setForm({ name: destination.name, host: destination.host, port: String(destination.port), protocol: destination.protocol, username: destination.username, password: "", noPassword: false, autologin: destination.autologin });
    setFeedback("");
    setFeedbackError(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFeedback("");
    setFeedbackError(false);
    try {
      const payload: Record<string, unknown> = { name: form.name.trim(), host: form.host.trim(), port: Number(form.port), protocol: form.protocol, username: form.username.trim(), autologin: form.autologin };
      if (!editingId || form.noPassword) payload.password = form.noPassword ? "" : form.password;
      else if (form.password) payload.password = form.password;
      const response = await fetch(editingId ? `/api/modules/remote-desktop/destinations/${encodeURIComponent(editingId)}` : "/api/modules/remote-desktop/destinations", {
        method: editingId ? "PUT" : "POST",
        headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify(payload),
      });
      const destination = await responseBody<Destination>(response);
      setDestinations((current) => [...current.filter((item) => item.id !== destination.id), destination].sort((a, b) => a.name.localeCompare(b.name)));
      setFeedback(`${destination.name} saved.`);
      setForm(blankForm);
      setEditingId("");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not save destination.");
      setFeedbackError(true);
    } finally { setSaving(false); }
  }

  async function remove(destination: Destination) {
    if (!window.confirm(`Remove ${destination.name}?`)) return;
    setFeedback("");
    try {
      const response = await fetch(`/api/modules/remote-desktop/destinations/${encodeURIComponent(destination.id)}`, { method: "DELETE", headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken } });
      await responseBody<{ id: string }>(response);
      setDestinations((current) => current.filter((item) => item.id !== destination.id));
      if (editingId === destination.id) startAdd();
      setFeedback(`${destination.name} removed.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not remove destination.");
      setFeedbackError(true);
    }
  }

  return <section className="remote-desktop-settings" aria-labelledby="remote-desktop-settings-title">
    <div className="server-admin-panel-heading"><h3 id="remote-desktop-settings-title">Remote desktop destinations</h3><p>Destinations are saved for {site?.location ?? "this site"}. Passwords are encrypted on the server.</p></div>
    {loading ? <p className="remote-desktop-settings-empty">Loading destinations…</p> : destinations.length === 0 ? <p className="remote-desktop-settings-empty">No destinations have been configured for this site.</p> : <div className="remote-desktop-destination-list">{destinations.map((destination) => <article className={`remote-desktop-destination ${editingId === destination.id ? "remote-desktop-destination-active" : ""}`} key={destination.id}><button className="remote-desktop-destination-select" type="button" onClick={() => startEdit(destination)}><strong>{destination.name}</strong><small>{destination.protocol.toUpperCase()} · {destination.host}:{destination.port} · {destination.passwordConfigured ? "Password saved" : "No password"}</small></button><button className="icon-button" type="button" aria-label={`Remove ${destination.name}`} onClick={() => void remove(destination)}><Trash2 size={15} /></button></article>)}</div>}
    <form className="remote-desktop-destination-form" onSubmit={save}>
      <h4>{editingId ? "Edit destination" : "Add destination"}</h4>
      <div className="remote-desktop-form-grid"><label>Name<input value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} maxLength={100} required /></label><label>Host<input value={form.host} onChange={(event) => setForm((value) => ({ ...value, host: event.target.value }))} maxLength={253} placeholder="192.168.1.20 or host.example" required /></label><label>Protocol<select value={form.protocol} onChange={(event) => { const protocol = event.target.value as Protocol; setForm((value) => ({ ...value, protocol, port: value.port === "3389" || value.port === "5900" ? protocol === "rdp" ? "3389" : "5900" : value.port })); }}><option value="rdp">RDP</option><option value="vnc">VNC</option><option value="spice">SPICE</option></select></label><label>Port<input type="number" min={1} max={65535} value={form.port} onChange={(event) => setForm((value) => ({ ...value, port: event.target.value }))} required /></label><label>Username<input value={form.username} onChange={(event) => setForm((value) => ({ ...value, username: event.target.value }))} maxLength={256} /></label><label>Password<input type="password" value={form.password} onChange={(event) => setForm((value) => ({ ...value, password: event.target.value, noPassword: false }))} maxLength={1024} autoComplete="new-password" placeholder={editingId ? "Leave blank to keep current" : "Optional"} /></label></div>
      <label className="remote-desktop-setting-toggle"><input type="checkbox" checked={form.noPassword} onChange={(event) => setForm((value) => ({ ...value, noPassword: event.target.checked, password: "" }))} /><span>Use an empty password</span></label>
      <label className="remote-desktop-setting-toggle"><input type="checkbox" checked={form.autologin} onChange={(event) => setForm((value) => ({ ...value, autologin: event.target.checked }))} /><span>Autologin with saved credentials</span></label>
      <div className="remote-desktop-form-actions"><button className="button button-secondary" type="button" onClick={startAdd}><Plus size={15} />New</button><button className="button button-primary" type="submit" disabled={saving || !departmentId}><Check size={15} />{saving ? "Saving…" : editingId ? "Save destination" : "Add destination"}</button></div>
      {feedback && <p className={feedbackError ? "remote-desktop-settings-error" : "remote-desktop-settings-feedback"} role={feedbackError ? "alert" : "status"}>{feedback}</p>}
    </form>
  </section>;
}
