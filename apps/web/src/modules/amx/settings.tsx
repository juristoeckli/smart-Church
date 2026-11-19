import { useEffect, useState, type FormEvent } from "react";
import type { ModuleSettingsContext } from "../../module-registry";
import "./amx.css";

type Action = { id: string; name: string; command: string };
type Settings = { host: string; port: number; actions: Action[] };
const roomActions: Action[] = [
  { id: "hall-crosswise", name: "Gemeindesaal quer", command: "" },
  { id: "hall-lengthwise", name: "Gemeindesaal längs", command: "" },
  { id: "conference-1", name: "Konferenzsaal 1", command: "" },
  { id: "library", name: "Bibliothek", command: "" },
  { id: "all-autonomous", name: "Alle Räume Autonom", command: "" },
  { id: "conference-large", name: "Konferenz gross", command: "" },
];
const initialSettings: Settings = { host: "10.2.14.10", port: 23, actions: roomActions };

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
      .then(setSettings)
      .catch((error: unknown) => { if (!controller.signal.aborted) { setFeedback(error instanceof Error ? error.message : "Could not load AMX settings."); setFailed(true); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [departmentId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setFeedback(""); setFailed(false);
    try {
      const response = await fetch("/api/modules/amx/settings", { method: "PUT", headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken }, body: JSON.stringify(settings) });
      setSettings(await readResponse<Settings>(response)); setFeedback("AMX settings saved.");
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Could not save AMX settings."); setFailed(true); }
    finally { setSaving(false); }
  }

  function updateAction(id: string, command: string) {
    setSettings((current) => ({ ...current, actions: current.actions.map((action) => action.id === id ? { ...action, command } : action) }));
  }

  return <section className="amx-panel" aria-labelledby="amx-settings-title">
    <div className="server-admin-panel-heading"><h3 id="amx-settings-title">AMX NetLinx controller</h3><p>The touch panel reports its NetLinx master at 10.2.14.10. Telnet port 23 accepts commands; panel connection port 1319 is separate.</p></div>
    {loading ? <p>Loading AMX settings…</p> : <form className="amx-form" onSubmit={(event) => void save(event)}>
      <div className="amx-form-grid"><label>NetLinx master host<input value={settings.host} onChange={(event) => setSettings((current) => ({ ...current, host: event.target.value }))} placeholder="10.2.14.10" required maxLength={253} /></label><label>Telnet port<input type="number" min={1} max={65535} value={settings.port} onChange={(event) => setSettings((current) => ({ ...current, port: Number(event.target.value) }))} required /></label></div>
      <h4>Room commands</h4>
      {settings.actions.map((action) => <div className="amx-action-editor" key={action.id}><strong>{action.name}</strong><label>NetLinx command<input aria-label={`${action.name} NetLinx command`} value={action.command} maxLength={512} onChange={(event) => updateAction(action.id, event.target.value)} placeholder="SEND_COMMAND 5001:1:0,'ROUTE-ON'" /></label></div>)}
      <p>Enter the Telnet console command for each room button. Commands are sent only when that button is pressed. Leave an action empty to keep its button disabled.</p>
      <button className="button button-primary" type="submit" disabled={saving || !departmentId}>{saving ? "Saving…" : "Save AMX settings"}</button>
      {feedback && <p className={failed ? "amx-error" : "amx-feedback"} role="status">{feedback}</p>}
    </form>}
  </section>;
}
