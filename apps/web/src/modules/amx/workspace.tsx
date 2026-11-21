import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ModuleContext } from "../../module-registry";
import { audioPages } from "./audio-pages";
import layoutJson from "../../../../api/src/modules/amx/tp4-layout.json";
import "./amx.css";

type PanelState = { number: number; style?: string; backgroundColor?: string; fontColor?: string; textColor?: string; fontId?: number; text?: string; bitmap?: string; bitmapX?: number; bitmapY?: number; textX?: number; textY?: number; iconX?: number; iconY?: number; justification?: number; textEffect?: number };
type PanelObject = { id: number; type: string; name: string; x: number; y: number; width: number; height: number; z: number; channel?: number | null; channelPort?: number | null; level?: number | null; levelPort?: number | null; rangeLow?: number; rangeHigh?: number; pageFlip?: string | null; label?: string; states?: PanelState[] };
type PanelPage = { id: number; name: string; kind: string; group?: string | null; canvas: { x?: number | null; y?: number | null; width: number; height: number }; objects: PanelObject[] };
type PanelLayout = { project: { screen: { width: number; height: number } }; pages: PanelPage[]; palette?: Array<{ name: string; rgba: string }> };
type Action = { id: string; name: string; channel: number; port?: number };
type Status = { configured: boolean };
type LevelFeedback = { page: string; values: Record<string, number>; updatedAt: string };
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
const portForObject = (page: PanelPage, object: PanelObject) => object.channelPort && object.channelPort > 0
  ? object.channelPort
  : page.kind === "page" || page.name.startsWith("PWR_") ? 1 : 2;
const mainAudioPage = (room: string, label: string) => {
  const prefix = roomPrefix[room] ?? (room === "Konferenz gross" || room === "Konferenzsaal" ? "Kon" : undefined);
  const suffix = label === "Volumen" ? "Volume" : label === "Mikrofon" ? "Mik" : "Lautsprecher";
  return prefix ? findPage(`${prefix}_${suffix}`) : ["Alle Räume Autonom", "Alle Räume", "All rooms"].includes(room) ? findPage(`All_${suffix}`) : undefined;
};

async function readResponse<T>(response: Response): Promise<T & { error?: string }> {
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "The AMX request failed.");
  return data;
}

function stateFor(object: PanelObject, active = false) { return object.states?.find((state) => state.number === (active ? 2 : 1)) ?? object.states?.[0]; }
function labelFor(object: PanelObject, state = stateFor(object)) {
  if (typeof state?.text === "string") return state.text;
  if (state?.bitmap || (object.type === "general" && typeof object.channel === "number")) return "";
  const label = object.label ?? object.name;
  return object.type === "general" && /^Button \d+$/.test(label.trim()) ? "" : label;
}

export function AmxWorkspace({ departmentId, csrfToken }: ModuleContext) {
  const [status, setStatus] = useState<Status | null>(null);
  const [levelValues, setLevelValues] = useState<Record<string, number>>({});
  const [basePageName, setBasePageName] = useState("Home");
  const [overlayPages, setOverlayPages] = useState<string[]>([]);
  const [selectedRoom, setSelectedRoom] = useState(() => window.sessionStorage.getItem("amx-selected-room") ?? "");
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);
  const [time, setTime] = useState(() => new Intl.DateTimeFormat("de-CH", { hour: "2-digit", minute: "2-digit" }).format(new Date()));
  const currentPage = findPage(overlayPages.at(-1) ?? basePageName) ?? findPage("Home")!;
  const visibleModePage = [...overlayPages].reverse().find((name) => name === "Regie" || /_(Volume|Mik|Lautsprecher)$/.test(name));
  const selectedModeChannel = visibleModePage === "Regie" ? 8 : visibleModePage?.endsWith("_Volume") ? 5 : visibleModePage?.endsWith("_Mik") ? 6 : visibleModePage?.endsWith("_Lautsprecher") ? 7 : undefined;
  const visiblePages = [findPage(basePageName) ?? findPage("Home")!, ...overlayPages.flatMap((name) => {
    const page = findPage(name);
    return page ? [page] : [];
  })];
  const pageScale = useMemo(() => ({ width: "100%", aspectRatio: `${panel.project.screen.width}/${panel.project.screen.height}` }), []);
  const configured = Boolean(status?.configured);

  async function refreshPageLevels(page: PanelPage = currentPage, signal?: AbortSignal): Promise<Record<string, number>> {
    if (!page.objects.some((object) => object.type === "bargraph" && typeof object.level === "number" && typeof object.levelPort === "number" && object.levelPort > 0)) return {};
    const response = await fetch(`/api/modules/amx/levels?page=${encodeURIComponent(page.name)}`, { headers: { "x-department-id": departmentId }, signal });
    const result = await readResponse<LevelFeedback>(response);
    setLevelValues((current) => ({ ...current, ...result.values }));
    return result.values;
  }

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/modules/amx/status", { headers: { "x-department-id": departmentId }, signal: controller.signal })
      .then((response) => readResponse<Status>(response)).then(setStatus)
      .catch((error: unknown) => { if (!controller.signal.aborted) { setFeedback(error instanceof Error ? error.message : "Could not load AMX controller status."); setFailed(true); } });
    return () => controller.abort();
  }, [departmentId]);
  useEffect(() => { const timer = window.setInterval(() => setTime(new Intl.DateTimeFormat("de-CH", { hour: "2-digit", minute: "2-digit" }).format(new Date())), 30_000); return () => window.clearInterval(timer); }, []);

  useEffect(() => {
    if (!configured || !currentPage.objects.some((object) => object.type === "bargraph" && typeof object.level === "number" && typeof object.levelPort === "number" && object.levelPort > 0)) return;
    let timer = 0;
    let active = true;
    const controller = new AbortController();
    const poll = async () => {
      try {
        await refreshPageLevels(currentPage, controller.signal);
      } catch (error) {
        if (active && !controller.signal.aborted) {
          const pageLevelIds = currentPage.objects.filter((object) => object.type === "bargraph" && typeof object.level === "number").map((object) => String(object.level));
          setLevelValues((current) => {
            const next = { ...current };
            for (const id of pageLevelIds) delete next[id];
            return next;
          });
          setFeedback(error instanceof Error ? `Live level feedback: ${error.message}` : "Live level feedback could not be read.");
          setFailed(true);
        }
      } finally {
        if (active) timer = window.setTimeout(() => void poll(), 15_000);
      }
    };
    void poll();
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [configured, currentPage, departmentId]);

  useEffect(() => {
    if (!configured || currentPage.name !== "PWR_COUNT") return;
    let active = true;
    let timer = 0;
    const controller = new AbortController();
    setLevelValues((current) => { const next = { ...current }; delete next["1"]; return next; });
    const pollProgress = async () => {
      try {
        const values = await refreshPageLevels(currentPage, controller.signal);
        if (!active) return;
        if (values["1"] !== undefined && values["1"] >= 255) {
          setBasePageName("Modus");
          setOverlayPages([]);
          setFeedback("");
          setFailed(false);
          return;
        }
        setFeedback("");
        setFailed(false);
      } catch (error) {
        if (active && !controller.signal.aborted) {
          setFeedback(error instanceof Error ? `Activation progress unavailable: ${error.message}` : "Activation progress is unavailable.");
          setFailed(true);
        }
      } finally {
        if (active) timer = window.setTimeout(() => void pollProgress(), 2000);
      }
    };
    void pollProgress();
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [configured, currentPage, departmentId]);

  function navigate(next: string) {
    const page = findPage(next);
    if (!page) return;
    if (page.kind === "page") {
      setBasePageName(page.name);
      setOverlayPages([]);
      return;
    }
    setOverlayPages((stack) => stack.at(-1) === page.name ? stack : [...stack, page.name]);
  }

  function closeOverlay() {
    setOverlayPages((stack) => stack.slice(0, -1));
  }

  function chooseRoom(room: string) {
    window.sessionStorage.setItem("amx-selected-room", room);
    setSelectedRoom(room);
  }

  async function send(action: Action, sourcePage: PanelPage = currentPage, quietSuccess = false) {
    if (!configured || busy) return false;
    setBusy(action.id); setFeedback(""); setFailed(false);
    try {
      await readResponse(await fetch("/api/modules/amx/send", { method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken }, body: JSON.stringify({ actionId: action.id }) }));
      if (!quietSuccess) setFeedback(`${action.name}: sent.`);
      if (sourcePage.objects.some((object) => object.type === "bargraph" && typeof object.level === "number")) {
        void refreshPageLevels(sourcePage).catch((error: unknown) => {
          if (error instanceof Error) { setFeedback(`Live level feedback: ${error.message}`); setFailed(true); }
        });
      }
      return true;
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not send the AMX action."); setFailed(true);
      return false;
    } finally { setBusy(""); }
  }

  async function handleObject(object: PanelObject, sourcePage: PanelPage = currentPage) {
    const label = labelFor(object);
    if (["zurück", "back"].some((word) => label.trim().toLocaleLowerCase().endsWith(word))) {
      goBack();
      return;
    }
    const channel = object.channel ?? 0;
    const port = portForObject(sourcePage, object);
    const action = actionIndex.get(`${port}:${channel}`);
    if (sourcePage.name === "Home" && object.pageFlip === "PWR_ASK" && roomChannels[channel]) {
      chooseRoom(roomChannels[channel]!);
      navigate("PWR_ASK");
      if (action) void send(action, sourcePage, true);
      return;
    }
    if (sourcePage.name === "PWR_ASK" && channel === 2) {
      navigate("PWR_COUNT");
      if (action) void send(action, sourcePage, true);
      return;
    }
    if (sourcePage.name === "Modus" && object.pageFlip === "DetailPopup") {
      const mode = channel === 5 ? "Volumen" : channel === 6 ? "Mikrofon" : channel === 7 ? "Lautsprecher" : "";
      const target = mode ? mainAudioPage(selectedRoom, mode) : undefined;
      if (target) navigate(target.name);
      else { setFeedback("Select a room before opening its controls."); setFailed(true); }
      return;
    }
    if (sourcePage.name === "Modus" && channel === 8) {
      navigate("Regie");
      return;
    }
    const sent = action ? await send(action, sourcePage) : true;
    if (!sent) return;

    if (sourcePage.name === "PWR_ASK") {
      if (roomChannels[channel]) {
        chooseRoom(roomChannels[channel]!);
        return;
      }
      if (channel === 4) closeOverlay();
      return;
    }
    if (sourcePage.name === "PWR_OFF_ASK") {
      if (channel === 3) navigate("Home");
      else if (channel === 4) closeOverlay();
      return;
    }
    if (sourcePage.name === "Modus") {
      if (roomChannels[channel] && channel !== 5 && channel !== 6 && channel !== 7) {
        chooseRoom(roomChannels[channel]!);
      }
    }
    if (object.pageFlip) {
      const target = findPage(object.pageFlip);
      if (object.pageFlip === "DetailPopup" || object.pageFlip === "EQ" || target?.name === sourcePage.name) {
        closeOverlay();
      } else if (target) {
        navigate(target.name);
      }
    }
  }

  function goBack() {
    if (overlayPages.length) {
      closeOverlay();
      return;
    }
    if (basePageName !== "Home") setBasePageName("Home");
  }

  const renderObject = (page: PanelPage, object: PanelObject, layer: number): ReactNode => {
    const activeRoomState = typeof object.channel === "number" && roomChannels[object.channel] === selectedRoom;
    const activeModeState = page.name === "Modus" && selectedModeChannel === object.channel;
    const state = stateFor(object, activeRoomState || activeModeState);
    const baseText = labelFor(object, state);
    const levelValue = object.type === "bargraph" && typeof object.level === "number" ? levelValues[String(object.level)] : undefined;
    const low = object.rangeLow ?? 0;
    const high = object.rangeHigh ?? 100;
    const levelPercent = levelValue === undefined || high <= low ? undefined : Math.max(0, Math.min(100, (levelValue - low) / (high - low) * 100));
    const activationLevel = levelValues["1"];
    const activationPercent = activationLevel === undefined ? undefined : Math.max(0, Math.min(100, activationLevel / 255 * 100));
    let text = object.type === "bargraph" ? levelPercent !== undefined ? `${Math.round(levelPercent)}%` : "—" : /^\d{1,2}:\d{2}$/.test(baseText) ? time : baseText;
    if (page.name === "PWR_COUNT" && object.name === "100 %") text = activationPercent === undefined ? "—" : `${Math.round(activationPercent)}%`;
    if (page.name === "PWR_COUNT" && /wird aktiviert/i.test(baseText)) {
      const title = selectedRoom === "Gemeindesaal quer" ? "Quer Gemeindesaal" : selectedRoom === "Gemeindesaal längs" ? "Längs Gemeindesaal" : selectedRoom;
      text = title ? `"${title}" wird aktiviert` : "Betriebsmodus wird aktiviert";
    }
    if (page.name === "Modus" && /^Betriebsmodus/.test(baseText)) text = selectedRoom ? `Betriebsmodus "${selectedRoom}"` : "Betriebsmodus";
    const isStyledChannelButton = object.type === "general" && typeof object.channel === "number" && object.channel > 0 && Boolean(state?.style);
    const isBackButton = object.type === "general" && ["zurück", "back"].includes(labelFor(object).trim().toLocaleLowerCase()) && Boolean(state?.style);
    const button = object.type === "general" && (isStyledChannelButton || Boolean(object.pageFlip) || isBackButton);
    const port = portForObject(page, object);
    const background = toCssColor(state?.backgroundColor);
    const foreground = toCssColor(state?.textColor) ?? toCssColor(state?.fontColor) ?? "#111";
    const bitmap = imageUrl(state?.bitmap);
    const originX = page.kind === "subpage" ? page.canvas.x ?? 0 : 0;
    const originY = page.kind === "subpage" ? page.canvas.y ?? 0 : 0;
    const style: CSSProperties = {
      left: `${(originX + object.x) / panel.project.screen.width * 100}%`, top: `${(originY + object.y) / panel.project.screen.height * 100}%`,
      width: `${object.width / panel.project.screen.width * 100}%`, height: `${object.height / panel.project.screen.height * 100}%`,
      zIndex: layer * 1000 + object.z, color: foreground, backgroundColor: background === "transparent" ? undefined : background,
      fontSize: state?.fontId === 33 ? "clamp(10px, 2.65vw, 22px)" : "clamp(8px, 1.55vw, 14px)",
    };
    const inner = <>
      {bitmap && <img className="amx-object-image" src={bitmap} alt="" />}
      {text && text !== "header" && text !== "StatusBar" && <span className={`amx-object-label${levelValue !== undefined ? " amx-level-value" : ""}`}>{text}</span>}
    </>;
    if (!button && object.type === "bargraph") {
      return <div key={`${page.id}-${object.id}`} className={`amx-panel-object amx-object-bargraph${page.name === "PWR_COUNT" ? " amx-progress-bar" : ""}`} style={style} aria-label={levelPercent === undefined ? "Level feedback unavailable" : `Level ${Math.round(levelPercent)} percent`}>
        {levelPercent !== undefined && <span className="amx-level-fill" style={page.name === "PWR_COUNT" ? { width: `${levelPercent}%` } : { height: `${levelPercent}%` }} />}{inner}
      </div>;
    }
    if (!button) return <div key={`${page.id}-${object.id}`} className={`amx-panel-object amx-object-${object.type}`} style={style}>{inner}</div>;
    const mapped = actionIndex.has(`${port}:${object.channel}`);
    const localNavigation = isBackButton || (!object.channel && Boolean(object.pageFlip));
    return <button key={`${page.id}-${object.id}`} type="button" className={`amx-panel-object amx-panel-button${state?.style?.includes("Inset") ? " is-active" : ""}`} style={style} disabled={busy !== "" || (!configured && mapped)} title={!mapped && !localNavigation ? "This TP4 channel has no confirmed send mapping." : !configured && mapped ? "Set the NetLinx host in AMX module settings." : undefined} onClick={() => void handleObject(object, page)}>{inner}{mapped && busy === actionIndex.get(`${port}:${object.channel}`)?.id && <i className="amx-button-busy" />}{!mapped && !localNavigation && <span className="amx-unmapped-mark" aria-label="Mapping unavailable">!</span>}</button>;
  };

  const screenStyle: CSSProperties = { ...pageScale, backgroundImage: basePageName === "Home" ? `url("${imageUrl("Copy of CS_Background.png") ?? ""}")` : undefined };

  return <section className="amx-workspace" aria-label="AMX room control">
    <div className="amx-panel-frame">
      <div className="amx-panel-screen" style={screenStyle}>
        {visiblePages.map((page, layer) => page.objects.map((object) => renderObject(page, object, layer)))}
        {feedback && <p className={`amx-toast${failed ? " amx-toast-error" : ""}`} role="status" aria-live="polite">{feedback}</p>}
        {currentPage.name === "PWR_COUNT" && failed && <button type="button" className="amx-progress-continue" onClick={() => { setBasePageName("Modus"); setOverlayPages([]); setFeedback(""); setFailed(false); }}>Weiter</button>}
      </div>
    </div>
    {!configured && status && <p className="amx-setup-note">A site administrator must enter the NetLinx master IP address under Settings → Modules → AMX to enable controls.</p>}
  </section>;
}
