import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ModuleContext } from "../../module-registry";
import { audioPages } from "./audio-pages";
import layoutJson from "../../../../api/src/modules/amx/tp4-layout.json";
import "./amx.css";

type PanelState = { number: number; style?: string; backgroundColor?: string; fontColor?: string; textColor?: string; fontId?: number; text?: string; bitmap?: string; bitmapX?: number; bitmapY?: number; textX?: number; textY?: number; iconX?: number; iconY?: number; justification?: number; textEffect?: number };
type PanelObject = { id: number; type: string; name: string; x: number; y: number; width: number; height: number; z: number; channel?: number | null; channelPort?: number | null; pageFlip?: string | null; label?: string; states?: PanelState[] };
type PanelPage = { id: number; name: string; kind: string; group?: string | null; canvas: { x?: number | null; y?: number | null; width: number; height: number }; objects: PanelObject[] };
type PanelLayout = { project: { screen: { width: number; height: number } }; pages: PanelPage[]; palette?: Array<{ name: string; rgba: string }> };
type Action = { id: string; name: string; channel: number; port?: number };
type Settings = { host: string; port: number };
const panel = layoutJson as unknown as PanelLayout;
const assets = import.meta.glob<string>("../../../../api/src/modules/amx/assets/*", { eager: true, query: "?url", import: "default" });
const imageUrl = (name?: string) => name ? assets[`../../../../api/src/modules/amx/assets/${name}`] : undefined;
const roomChannels: Record<number, string> = { 11: "Gemeindesaal quer", 16: "Gemeindesaal längs", 13: "Konferenzsaal 1", 12: "Bibliothek", 15: "Alle Räume Autonom", 14: "Konferenz gross" };
const roomActions: Action[] = [
  { id: "hall-crosswise", name: "Gemeindesaal quer", channel: 11, port: 1 },
  { id: "hall-lengthwise", name: "Gemeindesaal längs", channel: 16, port: 1 },
  { id: "conference-1", name: "Konferenzsaal 1", channel: 13, port: 1 },
  { id: "library", name: "Bibliothek", channel: 12, port: 1 },
  { id: "all-autonomous", name: "Alle Räume Autonom", channel: 15, port: 1 },
  { id: "conference-large", name: "Konferenz gross", channel: 14, port: 1 },
];
const systemActions: Action[] = [
  { id: "power-confirm-on", name: "Activate selected room", channel: 2, port: 1 },
  { id: "power-cancel", name: "Cancel room activation", channel: 4, port: 1 },
  { id: "power-confirm-off", name: "Confirm system off", channel: 3, port: 1 },
  { id: "mode-volume", name: "Open volume", channel: 5, port: 1 },
  { id: "mode-microphone", name: "Open microphones", channel: 6, port: 1 },
  { id: "mode-speakers", name: "Open speakers", channel: 7, port: 1 },
  { id: "mode-regie", name: "Open control room", channel: 8, port: 1 },
];
const actionIndex = new Map<string, Action>();
for (const action of [...roomActions, ...systemActions, ...audioPages.flatMap((page) => page.controls.flatMap((control) => control.actions ?? []))]) {
  actionIndex.set(`${action.port ?? 2}:${action.channel}`, action);
}
const palette: Record<string, string> = { Grey2: "#d9d9d9", Grey5: "#898989", Black: "#000000", White: "#ffffff", Red: "#d92828", Transparent: "transparent", VeryLightYellow: "#e4e1c1", LightBlue: "#b9d8e8", MediumMint: "#acd5bb", ...Object.fromEntries((panel.palette ?? []).filter((item) => item.name).map((item) => [item.name, item.rgba])) };
const toCssColor = (color?: string) => !color ? undefined : color.startsWith("#") ? color : palette[color] ?? undefined;
const roomPrefix: Record<string, string> = { "Gemeindesaal quer": "Que", "Gemeindesaal längs": "Lan", "Konferenzsaal 1": "Kon", "Bibliothek": "Bib" };
const findPage = (name: string) => panel.pages.find((page) => page.name === name);
const mainAudioPage = (room: string, label: string) => {
  const prefix = roomPrefix[room] ?? (room === "Konferenz gross" ? "Kon" : undefined);
  const suffix = label === "Volumen" ? "Volume" : label === "Mikrofon" ? "Mik" : "Lautsprecher";
  return prefix ? findPage(`${prefix}_${suffix}`) : room === "Alle Räume Autonom" ? findPage(`All_${suffix}`) : undefined;
};

async function readResponse<T>(response: Response): Promise<T & { error?: string }> {
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "The AMX request failed.");
  return data;
}

function stateFor(object: PanelObject) { return object.states?.find((state) => state.number === 1) ?? object.states?.[0]; }
function labelFor(object: PanelObject) {
  const state = stateFor(object);
  if (typeof state?.text === "string") return state.text;
  if (state?.bitmap || (object.type === "general" && typeof object.channel === "number")) return "";
  return object.label ?? object.name;
}

export function AmxWorkspace({ departmentId, csrfToken }: ModuleContext) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pageName, setPageName] = useState("Home");
  const [selectedRoom, setSelectedRoom] = useState("");
  const [backStack, setBackStack] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);
  const [time, setTime] = useState(() => new Intl.DateTimeFormat("de-CH", { hour: "2-digit", minute: "2-digit" }).format(new Date()));
  const [popupGroup, setPopupGroup] = useState("");
  const currentPage = findPage(pageName) ?? findPage("Home")!;
  const pageScale = useMemo(() => ({ width: "100%", aspectRatio: `${panel.project.screen.width}/${panel.project.screen.height}` }), []);
  const configured = Boolean(settings?.host);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/modules/amx/settings", { headers: { "x-department-id": departmentId }, signal: controller.signal })
      .then((response) => readResponse<Settings>(response)).then(setSettings)
      .catch((error: unknown) => { if (!controller.signal.aborted) { setFeedback(error instanceof Error ? error.message : "Could not load AMX controller settings."); setFailed(true); } });
    return () => controller.abort();
  }, [departmentId]);
  useEffect(() => { const timer = window.setInterval(() => setTime(new Intl.DateTimeFormat("de-CH", { hour: "2-digit", minute: "2-digit" }).format(new Date())), 30_000); return () => window.clearInterval(timer); }, []);

  function navigate(next: string, push = true) {
    const page = findPage(next);
    if (!page) return;
    if (push && next !== pageName) setBackStack((stack) => [...stack, pageName]);
    setPageName(next);
    setPopupGroup("");
  }

  async function send(action: Action) {
    if (!configured || busy) return false;
    setBusy(action.id); setFeedback(""); setFailed(false);
    try {
      await readResponse(await fetch("/api/modules/amx/send", { method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken }, body: JSON.stringify({ actionId: action.id }) }));
      setFeedback(`${action.name}: sent.`);
      return true;
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not send the AMX action."); setFailed(true);
      return false;
    } finally { setBusy(""); }
  }

  async function handleObject(object: PanelObject) {
    const label = labelFor(object);
    const channel = object.channel ?? 0;
    const port = object.channelPort ?? (currentPage.kind === "page" || currentPage.name.startsWith("PWR_") ? 1 : 2);
    const action = actionIndex.get(`${port}:${channel}`);
    let sent = true;
    if (action) sent = await send(action);
    else if (object.pageFlip && !["n/a", "PWR_ASK", "PWR_OFF_ASK"].includes(object.pageFlip)) {
      const direct = findPage(object.pageFlip);
      if (direct) navigate(direct.name);
    }
    if (!sent) return;

    if (currentPage.name === "Home" && roomChannels[channel]) {
      setSelectedRoom(roomChannels[channel]);
      navigate("PWR_ASK");
      return;
    }
    if (currentPage.name === "PWR_ASK") {
      if (channel === 2) navigate("Modus");
      else if (channel === 4) navigate("Home");
      return;
    }
    if (currentPage.name === "PWR_OFF_ASK") {
      if (channel === 3) navigate("Home");
      else if (channel === 4) navigate("Modus");
      return;
    }
    if (currentPage.name === "Modus") {
      if (channel === 5) { const target = mainAudioPage(selectedRoom, "Volumen"); if (target) navigate(target.name); }
      else if (channel === 6) { const target = mainAudioPage(selectedRoom, "Mikrofon"); if (target) navigate(target.name); }
      else if (channel === 7) { const target = mainAudioPage(selectedRoom, "Lautsprecher"); if (target) navigate(target.name); }
      else if (channel === 8) navigate("Regie");
      else if (label.toLowerCase() === "off") navigate("PWR_OFF_ASK");
      return;
    }
    if (object.pageFlip) {
      const target = findPage(object.pageFlip);
      if (target) navigate(target.name);
      else if (object.pageFlip === "DetailPopup" || object.pageFlip === "EQ") setPopupGroup(object.pageFlip);
      else if (object.pageFlip === "PWR_OFF_ASK") navigate("PWR_OFF_ASK");
    }
  }

  function goBack() {
    const previous = backStack.at(-1) ?? (pageName === "Modus" ? "Home" : "Modus");
    setBackStack((stack) => stack.slice(0, -1));
    navigate(previous, false);
  }

  const renderObject = (object: PanelObject): ReactNode => {
    const state = stateFor(object);
    const baseText = labelFor(object);
    const text = /^\d{1,2}:\d{2}$/.test(baseText) ? time : baseText;
    const isStyledChannelButton = object.type === "general" && typeof object.channel === "number" && object.channel > 0 && Boolean(state?.style);
    const button = object.type === "general" && (isStyledChannelButton || Boolean(object.pageFlip));
    const port = object.channelPort ?? (currentPage.kind === "page" || currentPage.name.startsWith("PWR_") ? 1 : 2);
    const background = toCssColor(state?.backgroundColor);
    const foreground = toCssColor(state?.textColor) ?? toCssColor(state?.fontColor) ?? "#111";
    const bitmap = imageUrl(state?.bitmap);
    const originX = currentPage.kind === "subpage" ? currentPage.canvas.x ?? 0 : 0;
    const originY = currentPage.kind === "subpage" ? currentPage.canvas.y ?? 0 : 0;
    const style: CSSProperties = {
      left: `${(originX + object.x) / panel.project.screen.width * 100}%`, top: `${(originY + object.y) / panel.project.screen.height * 100}%`,
      width: `${object.width / panel.project.screen.width * 100}%`, height: `${object.height / panel.project.screen.height * 100}%`,
      zIndex: object.z, color: foreground, backgroundColor: background === "transparent" ? undefined : background,
      fontSize: state?.fontId === 33 ? "clamp(10px, 2.65vw, 22px)" : "clamp(8px, 1.55vw, 14px)",
    };
    const inner = <>
      {bitmap && <img className="amx-object-image" src={bitmap} alt="" />}
      {text && text !== "header" && text !== "StatusBar" && <span className="amx-object-label">{text}</span>}
    </>;
    if (!button) return <div key={`${currentPage.id}-${object.id}`} className={`amx-panel-object amx-object-${object.type}`} style={style}>{inner}</div>;
    const mapped = actionIndex.has(`${port}:${object.channel}`);
    const isPageChange = Boolean(object.pageFlip) || currentPage.name === "Home" || currentPage.name.startsWith("PWR_") || currentPage.name === "Modus";
    return <button key={`${currentPage.id}-${object.id}`} type="button" className={`amx-panel-object amx-panel-button${state?.style?.includes("Inset") ? " is-active" : ""}`} style={style} disabled={busy !== "" || (!configured && mapped)} title={!mapped ? "This TP4 channel has no confirmed send mapping." : !configured ? "Set the NetLinx host in AMX module settings." : undefined} onClick={() => void handleObject(object)}>{inner}{mapped && busy === actionIndex.get(`${port}:${object.channel}`)?.id && <i className="amx-button-busy" />}{!mapped && !isPageChange && <span className="amx-unmapped-mark" aria-label="Mapping unavailable">!</span>}</button>;
  };

  const visibleObjects = currentPage.objects;
  const screenStyle: CSSProperties = { ...pageScale, backgroundImage: currentPage.name === "Home" ? `url("${imageUrl("Copy of CS_Background.png") ?? ""}")` : undefined };

  return <section className="amx-workspace" aria-label="AMX room control">
    <div className="amx-panel-frame">
      <div className="amx-panel-screen" style={screenStyle}>
        {visibleObjects.map(renderObject)}
        {currentPage.name !== "Home" && <button className="amx-panel-back" type="button" onClick={goBack} aria-label="Zurück">‹ Zurück</button>}
        {popupGroup && <div className="amx-panel-popup" role="dialog" aria-label="Select a control page"><div>{panel.pages.filter((page) => page.group === popupGroup).map((page) => <button key={page.id} type="button" onClick={() => navigate(page.name)}>{page.name.replaceAll("_", " · ")}</button>)}<button type="button" onClick={() => setPopupGroup("")}>Schliessen</button></div></div>}
        {feedback && <p className={`amx-toast${failed ? " amx-toast-error" : ""}`} role="status" aria-live="polite">{feedback}</p>}
      </div>
    </div>
    {!configured && settings && <p className="amx-setup-note">Enter the NetLinx master IP address under Settings → Modules → AMX to enable controls.</p>}
    <details className="amx-panel-map"><summary>All panel pages</summary><div>{panel.pages.filter((page) => page.kind === "subpage" && page.group === "ModusPopup").map((page) => <button key={page.id} type="button" onClick={() => navigate(page.name)}>{page.name.replaceAll("_", " · ")}</button>)}</div></details>
  </section>;
}
