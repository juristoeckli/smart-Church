import { useEffect, useState } from "react";
import { Wifi } from "lucide-react";
import type { ModuleContext } from "../../module-registry";
import { audioPages } from "./audio-pages";
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
function safeSettings(settings: Settings): Settings {
  const verifiedCommands: Record<string, string> = {
    "hall-crosswise": "PULSE[10001:1:0,11]",
    "hall-lengthwise": "PULSE[10001:1:0,16]",
    "conference-1": "PULSE[10001:1:0,13]",
    library: "PULSE[10001:1:0,12]",
    "all-autonomous": "PULSE[10001:1:0,15]",
    "conference-large": "PULSE[10001:1:0,14]",
  };
  return { ...settings, actions: rooms.map((room) => {
    return { id: room.id, name: room.name, command: verifiedCommands[room.id] };
  }) };
}
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
  const [selectedPage, setSelectedPage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/modules/amx/settings", { headers: { "x-department-id": departmentId }, signal: controller.signal })
      .then((response) => readResponse<Settings>(response)).then((loaded) => setSettings(safeSettings(loaded)))
      .catch((error: unknown) => { if (!controller.signal.aborted) { setFeedback(error instanceof Error ? error.message : "Could not load AMX controller settings."); setFailed(true); } });
    return () => controller.abort();
  }, [departmentId]);
  useEffect(() => { const timer = window.setInterval(() => setTime(currentTime()), 30_000); return () => window.clearInterval(timer); }, []);

  async function send(action: Pick<Action, "id" | "name">) {
    setBusy(action.id); setFeedback(""); setFailed(false);
    try {
      await readResponse(await fetch("/api/modules/amx/send", { method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken }, body: JSON.stringify({ actionId: action.id }) }));
      setFeedback(`${action.name}: channel pulse sent to the NetLinx master.`);
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Could not send the AMX action."); setFailed(true); }
    finally { setBusy(""); }
  }

  const selectedAudioPage = audioPages.find((page) => page.id === selectedPage);
  const configured = Boolean(settings?.host);

  return <section className="amx-workspace" aria-label="AMX room control">
    <div className="amx-screen">
      <div className="amx-photo-strip" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <span className={`amx-photo-tile amx-photo-tile-${index + 1}`} key={index}><i /></span>)}</div>
      <header className="amx-church-banner"><img src="/gfc-logo.svg" alt="GfC logo" /><div><strong>Gemeinde für Christus</strong><span>Evangelischer Brüderverein</span></div></header>
      <div className="amx-room-grid">{rooms.map((room) => {
        const action = settings?.actions.find((item) => item.id === room.id);
        return <button className="amx-room-button" type="button" key={room.id} disabled={!configured || !action?.command || Boolean(busy)} title={!configured ? "Enter the NetLinx host in AMX module settings" : !action?.command ? "Configure this NetLinx channel in AMX module settings" : undefined} onClick={() => action && void send(action)}>{busy === room.id ? "Senden…" : room.name}</button>;
      })}</div>
      <footer className="amx-status-bar" aria-label="Panel status"><span className="amx-dsp-label">DSP:</span>{[1, 2, 3, 4].map((number) => <span className="amx-dsp-indicator" key={number}><i aria-hidden="true" />{number}</span>)}<span className="amx-status-divider" /><Wifi className="amx-network-icon" size={18} aria-label="Network" /><time>{time}</time></footer>
      {feedback && <p className={failed ? "amx-toast amx-toast-error" : "amx-toast"} role="status">{feedback}</p>}
    </div>
    {settings && !configured && <p className="amx-setup-note">Enter the NetLinx master IP address or hostname under Settings → Modules → AMX. Controls stay disabled until it is configured.</p>}
    <section className="amx-pages" aria-label="AMX audio pages">
      <h3>Audio pages</h3>
      <p>These controls use channel mappings read from the Steffisburg TP4 panel project. Volume buttons send channel pulses; level feedback is not displayed.</p>
      <div className="amx-page-nav">{audioPages.map((page) => <button key={page.id} type="button" className={selectedPage === page.id ? "amx-page-tab active" : "amx-page-tab"} onClick={() => setSelectedPage((current) => current === page.id ? "" : page.id)} aria-pressed={selectedPage === page.id}>{page.room} · {page.page}</button>)}</div>
      {selectedAudioPage && <div className="amx-audio-placeholder">
        <h4>{selectedAudioPage.room} · {selectedAudioPage.page}</h4>
          <div className="amx-audio-controls">{selectedAudioPage.controls.map((control) => <div className="amx-audio-control" key={control.id} aria-disabled={control.unavailable || Boolean(control.readonly) || undefined}>
            <span>{control.name}</span>
            {control.actions && <div className="amx-audio-control-actions">{control.actions.map((action) => <button type="button" key={action.id} disabled={!configured || Boolean(busy)} title={!configured ? "Enter the NetLinx host in AMX module settings" : `TPDesign port ${action.port ?? 2}, channel ${action.channel}`} aria-label={`${control.name} ${action.name}`} onClick={() => void send({ id: action.id, name: `${control.name} ${action.name}` })}>{busy === action.id ? "…" : action.name}</button>)}</div>}
            {control.readonly && <span className="amx-control-unavailable">{control.readonly}</span>}
            {control.unavailable && <span className="amx-control-unavailable">Unavailable</span>}
          </div>)}</div>
          <p>Buttons send the listed NetLinx channel. Display-only level meters and page popups are not interactive in this module.</p>
      </div>}
    </section>
  </section>;
}
