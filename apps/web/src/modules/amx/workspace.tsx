import { useEffect, useState } from "react";
import { Wifi } from "lucide-react";
import type { ModuleContext } from "../../module-registry";
import "./amx.css";

type Action = { id: string; name: string; command: string };
type Settings = { host: string; port: number; actions: Action[] };
const rooms = [
  { id: "hall-crosswise", name: "Gemeindesaal quer" },
  { id: "hall-lengthwise", name: "Gemeindesaal längs" },
  { id: "conference-1", name: "Konferenzsaal 1" },
  { id: "library", name: "Bibliothek" },
  { id: "all-autonomous", name: "Alle Räume Autonom" },
  { id: "conference-large", name: "Konferenz gross" },
];
async function readResponse<T>(response: Response): Promise<T & { error?: string }> {
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "The AMX request failed.");
  return data;
}
function currentTime() { return new Intl.DateTimeFormat("de-CH", { hour: "2-digit", minute: "2-digit" }).format(new Date()); }

export function AmxWorkspace({ departmentId, csrfToken }: ModuleContext) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);
  const [time, setTime] = useState(currentTime);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/modules/amx/settings", { headers: { "x-department-id": departmentId }, signal: controller.signal })
      .then((response) => readResponse<Settings>(response)).then(setSettings)
      .catch((error: unknown) => { if (!controller.signal.aborted) { setFeedback(error instanceof Error ? error.message : "Could not load AMX controller settings."); setFailed(true); } });
    return () => controller.abort();
  }, [departmentId]);
  useEffect(() => { const timer = window.setInterval(() => setTime(currentTime()), 30_000); return () => window.clearInterval(timer); }, []);

  async function send(action: Action) {
    setBusy(action.id); setFeedback(""); setFailed(false);
    try {
      await readResponse(await fetch("/api/modules/amx/send", { method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken }, body: JSON.stringify({ actionId: action.id }) }));
      setFeedback(`${action.name}: channel pulse sent to the NetLinx master.`);
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Could not send the AMX action."); setFailed(true); }
    finally { setBusy(""); }
  }

  return <section className="amx-workspace" aria-label="AMX room control">
    <div className="amx-screen">
      <div className="amx-photo-strip" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <span className={`amx-photo-tile amx-photo-tile-${index + 1}`} key={index}><i /></span>)}</div>
      <header className="amx-church-banner"><img src="/gfc-logo.svg" alt="GfC logo" /><div><strong>Gemeinde für Christus</strong><span>Evangelischer Brüderverein</span></div></header>
      <div className="amx-room-grid">{rooms.map((room) => {
        const action = settings?.actions.find((item) => item.id === room.id);
        return <button className="amx-room-button" type="button" key={room.id} disabled={!action?.command || Boolean(busy)} title={!action?.command ? "Configure this NetLinx channel in AMX module settings" : undefined} onClick={() => action && void send(action)}>{busy === room.id ? "Senden…" : room.name}</button>;
      })}</div>
      <footer className="amx-status-bar" aria-label="Panel status"><span className="amx-dsp-label">DSP:</span>{[1, 2, 3, 4].map((number) => <span className="amx-dsp-indicator" key={number}><i aria-hidden="true" />{number}</span>)}<span className="amx-status-divider" /><Wifi className="amx-network-icon" size={18} aria-label="Network" /><time>{time}</time></footer>
      {feedback && <p className={failed ? "amx-toast amx-toast-error" : "amx-toast"} role="status">{feedback}</p>}
    </div>
    {settings && rooms.some((room) => !settings.actions.find((action) => action.id === room.id)?.command) && <p className="amx-setup-note">Some buttons are disabled until their NetLinx device and channel mappings are configured under Settings → Modules → AMX Control.</p>}
  </section>;
}
