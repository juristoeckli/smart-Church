import { useEffect, useState, type FormEvent } from "react";
import type { ModuleSettingsContext } from "../../module-registry";
import { audioPages } from "./audio-pages";
import "./amx.css";

type Action = { id: string; name: string; command: string };
type Settings = { host: string; port: number; username: string; password: string; clearPassword: boolean; passwordConfigured?: boolean; actions: Action[] };
const roomActions: Action[] = [
  { id: "hall-crosswise", name: "Gemeindesaal quer", command: "ICSP[33001:1:1,11]" },
  { id: "hall-lengthwise", name: "Gemeindesaal längs", command: "ICSP[33001:1:1,16]" },
  { id: "conference-1", name: "Konferenzsaal 1", command: "ICSP[33001:1:1,13]" },
  { id: "library", name: "Bibliothek", command: "ICSP[33001:1:1,12]" },
  { id: "all-autonomous", name: "Alle Räume Autonom", command: "ICSP[33001:1:1,15]" },
  { id: "conference-large", name: "Konferenz gross", command: "ICSP[33001:1:1,14]" },
];
const initialSettings: Settings = { host: "", port: 23, username: "", password: "", clearPassword: false, actions: roomActions };

function completeSettings(settings: Partial<Settings>): Settings {
  return { ...initialSettings, ...settings, actions: roomActions, password: "", clearPassword: false };
}

async function readResponse<T>(response: Response): Promise<T & { error?: string }> {
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "The AMX request failed.");
  return data;
}

export function AmxSettings({ departmentId, csrfToken }: ModuleSettingsContext) {
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void fetch("/api/modules/amx/settings", { headers: { "x-department-id": departmentId }, signal: controller.signal })
      .then((response) => readResponse<Settings>(response))
      .then((loaded) => setSettings(completeSettings(loaded)))
      .catch((error: unknown) => { if (!controller.signal.aborted) { setFeedback(error instanceof Error ? error.message : "Could not load AMX settings."); setFailed(true); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [departmentId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setFeedback(""); setFailed(false);
    try {
      const response = await fetch("/api/modules/amx/settings", { method: "PUT", headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken }, body: JSON.stringify(settings) });
      setSettings(completeSettings(await readResponse<Settings>(response))); setFeedback("AMX settings saved.");
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Could not save AMX settings."); setFailed(true); }
    finally { setSaving(false); }
  }

  return <section className="amx-panel" aria-labelledby="amx-settings-title">
    <div className="server-admin-panel-heading"><h3 id="amx-settings-title">GfC Steffisburg AMX integration</h3><p>Controls use the existing NetLinx virtual device 33001; the physical touchpanel is 10001. Room, level, and progress feedback is read from the combined controller devices. Smart-Church does not change NetLinx settings, authentication, or encryption.</p></div>
    {loading ? <p>Loading AMX settings…</p> : <form className="amx-form" onSubmit={(event) => void save(event)}>
      <label>NetLinx master IP address or hostname<input value={settings.host} onChange={(event) => setSettings((current) => ({ ...current, host: event.target.value }))} placeholder="Enter the controller IP address or hostname" required maxLength={253} /></label>
      <label>Telnet port<input type="number" min={1} max={65535} value={settings.port} onChange={(event) => setSettings((current) => ({ ...current, port: Number(event.target.value) }))} required /></label>
      <p>AMX terminal control and feedback use Telnet (default port 23). Leave the login empty unless the controller already prompts for one. This module never enables or changes authentication.</p>
      <label>Existing NetLinx username<input autoComplete="username" value={settings.username} onChange={(event) => setSettings((current) => ({ ...current, username: event.target.value }))} maxLength={64} /></label>
      <label>Existing NetLinx password<input type="password" autoComplete="current-password" value={settings.password} onChange={(event) => setSettings((current) => ({ ...current, password: event.target.value, clearPassword: false }))} maxLength={256} placeholder={settings.passwordConfigured ? "Saved password is retained if left blank" : "Leave empty if Telnet has no login"} /></label>
      {settings.passwordConfigured && <label className="amx-password-clear"><input type="checkbox" checked={settings.clearPassword} onChange={(event) => setSettings((current) => ({ ...current, clearPassword: event.target.checked, password: "" }))} />Clear the saved Telnet password</label>}
      <h4>Room channel mappings</h4>
      {roomActions.map((action) => <div className="amx-action-editor" key={action.id}><strong>{action.name}</strong><label>Controller event<input aria-label={`${action.name} controller event`} value={action.command} readOnly /></label></div>)}
      <p>These fixed mappings come from the Steffisburg TP4 project and cannot be edited here.</p>
      <h4>Audio pages</h4>
      <p>Audio and system controls use fixed mappings from the panel project. Meter graphics show read-only level values from NetLinx device status.</p>
      <button className="button button-primary" type="submit" disabled={saving || !departmentId}>{saving ? "Saving…" : "Save AMX settings"}</button>
      {feedback && <p className={failed ? "amx-error" : "amx-feedback"} role="status">{feedback}</p>}
    </form>}
  </section>;
}

