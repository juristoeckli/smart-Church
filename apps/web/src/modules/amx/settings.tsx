import { useEffect, useState, type FormEvent } from "react";
import type { ModuleSettingsContext } from "../../module-registry";
import { audioPages } from "./audio-pages";
import "./amx.css";

type Action = { id: string; name: string; command: string };
type Settings = { host: string; port: number; actions: Action[] };
const roomActions: Action[] = [
  { id: "hall-crosswise", name: "Gemeindesaal quer", command: "PULSE[10001:1:0,11]" },
  { id: "hall-lengthwise", name: "Gemeindesaal längs", command: "PULSE[10001:1:0,16]" },
  { id: "conference-1", name: "Konferenzsaal 1", command: "PULSE[10001:1:0,13]" },
  { id: "library", name: "Bibliothek", command: "PULSE[10001:1:0,12]" },
  { id: "all-autonomous", name: "Alle Räume Autonom", command: "PULSE[10001:1:0,15]" },
  { id: "conference-large", name: "Konferenz gross", command: "PULSE[10001:1:0,14]" },
];
const initialSettings: Settings = { host: "", port: 1319, actions: roomActions };

function completeSettings(settings: Settings): Settings {
  return { ...settings, actions: roomActions };
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
    <div className="server-admin-panel-heading"><h3 id="amx-settings-title">GfC Steffisburg AMX integration</h3><p>Smart-Church connects directly to the NetLinx master using AMX ICSP over TCP port 1319. The touchscreen is not required for control.</p></div>
    {loading ? <p>Loading AMX settings…</p> : <form className="amx-form" onSubmit={(event) => void save(event)}>
      <div className="amx-form-grid"><label>NetLinx master IP address or hostname<input value={settings.host} onChange={(event) => setSettings((current) => ({ ...current, host: event.target.value }))} placeholder="Enter the controller IP address or hostname" required maxLength={253} /></label><label>ICSP TCP port<input type="number" min={1} max={65535} value={settings.port} onChange={(event) => setSettings((current) => ({ ...current, port: Number(event.target.value) }))} required /></label></div>
      <h4>Room channel mappings</h4>
      {roomActions.map((action) => <div className="amx-action-editor" key={action.id}><strong>{action.name}</strong><label>Verified NetLinx channel<input aria-label={`${action.name} verified NetLinx channel`} value={action.command} readOnly /></label></div>)}
      <p>All six room channel mappings were verified from the TPDesign Home page and are read-only.</p>
      <h4>Audio pages</h4>
      <p>Panel page names and known control labels are shown in the workspace for reference. Audio interaction semantics and feedback are not verified; those controls are unavailable and have no channel mappings here.</p>
      <button className="button button-primary" type="submit" disabled={saving || !departmentId}>{saving ? "Saving…" : "Save AMX settings"}</button>
      {feedback && <p className={failed ? "amx-error" : "amx-feedback"} role="status">{feedback}</p>}
    </form>}
  </section>;
}
