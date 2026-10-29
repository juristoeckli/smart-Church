import { useCallback, useEffect, useRef, useState } from "react";
import { Expand, Laptop, LoaderCircle, LogOut, MonitorUp, Volume2, VolumeX, WifiOff } from "lucide-react";
import type { ModuleRealtime } from "../../module-registry";
import "./system-laptop.css";

interface GuacMouseState {}
interface GuacMouse {
  onmousedown: ((state: GuacMouseState) => void) | null;
  onmouseup: ((state: GuacMouseState) => void) | null;
  onmousemove: ((state: GuacMouseState) => void) | null;
}
interface GuacKeyboard {
  onkeydown: ((keysym: number) => void) | null;
  onkeyup: ((keysym: number) => void) | null;
}
interface GuacAudioContextFactory {
  singleton: AudioContext | null;
  getAudioContext(): AudioContext | null;
}
interface GuacAudioPlayer {
  getSupportedTypes(): string[];
}
interface GuacInputStream { index: number; onblob: ((data: string) => void) | null; onend: (() => void) | null; sendAck(message: string, code: number): void; }
interface GuacOutputStream { index: number; }
interface GuacStringReader { ontext: ((text: string) => void) | null; onend: (() => void) | null; }
interface GuacStringWriter { sendText(text: string): void; sendEnd(): void; }
interface GuacDisplay {
  getElement(): HTMLElement;
  getWidth(): number;
  getHeight(): number;
  scale(factor: number): void;
  onresize: ((width: number, height: number) => void) | null;
}
interface GuacClient {
  getDisplay(): GuacDisplay;
  connect(data: string): void;
  disconnect(): void;
  sendSize(width: number, height: number): void;
  sendMouseState(state: GuacMouseState): void;
  sendKeyEvent(pressed: number, keysym: number): void;
  createClipboardStream(mimetype: string): GuacOutputStream;
  sendBlob(index: number, data: string): void;
  endStream(index: number): void;
  onclipboard: ((stream: GuacInputStream, mimetype: string) => void) | null;
  onaudio: ((stream: unknown, mimetype: string) => null) | null;
  onstatechange: ((state: number) => void) | null;
  onerror: ((status: { message?: string }) => void) | null;
}
interface GuacSession {
  authToken: string;
  dataSource: string;
  connectionId: string;
  proxyTicket: string;
  role: "controller" | "viewer";
  width: number;
  height: number;
  tunnelUrl: string;
  libraryUrl: string;
}
interface RemoteDesktopDestination { id: string; name: string; host: string; port: number; protocol: "rdp" | "vnc" | "spice"; username: string; autologin: boolean; passwordConfigured: boolean; }
declare global {
  interface Window {
    Guacamole?: {
      Client: new (tunnel: unknown) => GuacClient;
      WebSocketTunnel: new (url: string) => unknown;
      Mouse: new (element: HTMLElement) => GuacMouse;
      Keyboard: new (element: HTMLElement) => GuacKeyboard;
      AudioContextFactory?: GuacAudioContextFactory;
      AudioPlayer: GuacAudioPlayer;
      StringReader: new (stream: GuacInputStream) => GuacStringReader;
      StringWriter: new (stream: GuacOutputStream) => GuacStringWriter;
    };
  }
}

let guacScriptPromise: Promise<void> | null = null;
let remoteAudioContext: AudioContext | null = null;

function setRemoteAudioPlayback(enabled: boolean): Promise<boolean> {
  const factory = window.Guacamole?.AudioContextFactory;
  // Guacamole may initialize its own singleton while its script is loading.
  // Always resume that context when it exists; resuming a separate context
  // created by the connect gesture would leave Guacamole's player suspended.
  if (factory?.singleton) remoteAudioContext = factory.singleton;
  try {
    const AudioContextConstructor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!remoteAudioContext && AudioContextConstructor) remoteAudioContext = new AudioContextConstructor();
    if (factory && remoteAudioContext && !factory.singleton) factory.singleton = remoteAudioContext;
    if (factory) remoteAudioContext = factory.getAudioContext() ?? remoteAudioContext;
    if (!remoteAudioContext) return Promise.resolve(false);
    if (enabled && remoteAudioContext.state === "suspended") {
      return remoteAudioContext.resume().then(() => remoteAudioContext?.state === "running").catch(() => false);
    }
    if (!enabled && remoteAudioContext.state === "running") {
      return remoteAudioContext.suspend().then(() => false).catch(() => remoteAudioContext?.state === "running");
    }
    return Promise.resolve(remoteAudioContext.state === "running");
  } catch { return Promise.resolve(false); }
}

function fitViewerDisplay(display: GuacDisplay, container: HTMLElement | null) {
  const width = display.getWidth();
  const height = display.getHeight();
  if (!container || !width || !height || !container.clientWidth || !container.clientHeight) return;
  display.scale(Math.min(1, container.clientWidth / width, container.clientHeight / height));
}

function loadGuacamoleClient(libraryUrl: string) {
  if (window.Guacamole) return Promise.resolve();
  if (guacScriptPromise) return guacScriptPromise;
  guacScriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = libraryUrl;
    script.async = true;
    script.onload = () => window.Guacamole ? resolve() : reject(new Error("The remote desktop client library did not load."));
    script.onerror = () => reject(new Error("Could not load the remote desktop client library."));
    document.head.append(script);
  }).catch((error: unknown) => {
    guacScriptPromise = null;
    throw error;
  });
  return guacScriptPromise;
}

function requestHeaders(departmentId: string, csrfToken: string) {
  return { "x-department-id": departmentId, "x-csrf-token": csrfToken, "content-type": "application/json" };
}

function currentDisplaySize(element: HTMLElement | null) {
  const width = Math.round(element?.clientWidth || window.innerWidth);
  const height = Math.round(element?.clientHeight || Math.max(200, window.innerHeight - 180));
  return { width: Math.max(320, Math.min(width, 3840)), height: Math.max(200, Math.min(height, 2160)) };
}

async function readApiResponse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.text();
  let result: T & { error?: string };
  try {
    if (!body.trim()) throw new Error("empty response");
    result = JSON.parse(body) as T & { error?: string };
  } catch {
    throw new Error(response.ok ? `${fallback} The server returned an invalid response.` : `${fallback} (HTTP ${response.status}).`);
  }
  if (!response.ok) throw new Error(result.error || `${fallback} (HTTP ${response.status}).`);
  return result;
}

export function SystemLaptopModule({ departmentId, csrfToken, realtime }: { departmentId: string; csrfToken: string; realtime?: ModuleRealtime }) {
  const displayRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<GuacClient | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const lastSizeRef = useRef<{ width: number; height: number } | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [destinations, setDestinations] = useState<RemoteDesktopDestination[]>([]);
  const [selectedDestinationId, setSelectedDestinationId] = useState("");
  const [canControl, setCanControl] = useState(false);
  const [canTakeOver, setCanTakeOver] = useState(false);
  const [controllerActive, setControllerActive] = useState(false);
  const [controllerStarting, setControllerStarting] = useState(false);
  const [controllerBusy, setControllerBusy] = useState(false);
  const [role, setRole] = useState<"controller" | "viewer" | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioStreamStatus, setAudioStreamStatus] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [remoteClipboard, setRemoteClipboard] = useState("");
  const [clipboardMessage, setClipboardMessage] = useState("");
  const [autoClipboardSync, setAutoClipboardSync] = useState(false);
  const lastClipboardSync = useRef("");
  const autoClipboardSyncRef = useRef(false);
  const selectedDestination = destinations.find((destination) => destination.id === selectedDestinationId);

  const disconnect = useCallback(() => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
    resizeTimerRef.current = null;
    lastSizeRef.current = null;
    clientRef.current?.disconnect();
    clientRef.current = null;
    if (displayRef.current) displayRef.current.replaceChildren();
    setConnected(false);
    setConnecting(false);
    setAutoClipboardSync(false);
  }, []);

  useEffect(() => { autoClipboardSyncRef.current = autoClipboardSync; }, [autoClipboardSync]);

  const sendClipboardToRemote = useCallback((text: string) => {
    const client = clientRef.current;
    const guac = window.Guacamole;
    if (!client || !guac || !text) return;
    const stream = client.createClipboardStream("text/plain");
    const writer = new guac.StringWriter(stream);
    writer.sendText(text);
    writer.sendEnd();
    lastClipboardSync.current = text;
  }, []);

  useEffect(() => {
    if (!connected || !autoClipboardSync) return;
    if (!navigator.clipboard?.readText) {
      setClipboardMessage("This browser does not allow clipboard reading here.");
      setAutoClipboardSync(false);
      return;
    }
    let denied = false;
    const syncLocalClipboard = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text !== lastClipboardSync.current) sendClipboardToRemote(text);
      } catch {
        if (!denied) setClipboardMessage("Allow clipboard access in your browser to use automatic sync.");
        denied = true;
      }
    };
    void syncLocalClipboard();
    const timer = window.setInterval(() => void syncLocalClipboard(), 1500);
    return () => window.clearInterval(timer);
  }, [connected, autoClipboardSync, sendClipboardToRemote]);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const statusUrl = new URL("/api/modules/remote-desktop/status", window.location.href);
        if (selectedDestinationId) statusUrl.searchParams.set("destinationId", selectedDestinationId);
        const response = await fetch(statusUrl, { headers: { "x-department-id": departmentId }, signal: controller.signal });
        const result = await readApiResponse<{ configured?: boolean; canControl?: boolean; canTakeOver?: boolean; controllerActive?: boolean; controllerStarting?: boolean; controllerBusy?: boolean; destinations?: RemoteDesktopDestination[] }>(response, "Could not check Remote desktop configuration.");
        const nextDestinations = result.destinations ?? [];
        setDestinations(nextDestinations);
        if (!selectedDestinationId && nextDestinations[0]) setSelectedDestinationId(nextDestinations[0].id);
        if (selectedDestinationId && !nextDestinations.some((destination) => destination.id === selectedDestinationId)) setSelectedDestinationId(nextDestinations[0]?.id ?? "");
        setConfigured(Boolean(result.configured));
        setCanControl(Boolean(result.canControl));
        setCanTakeOver(Boolean(result.canTakeOver));
        setControllerActive(Boolean(result.controllerActive));
        setControllerStarting(Boolean(result.controllerStarting));
        setControllerBusy(Boolean(result.controllerBusy));
      } catch (reason) {
        if (!controller.signal.aborted) {
          setConfigured(false);
          setError(reason instanceof Error ? reason.message : "Could not check Remote desktop configuration.");
        }
      }
    };
    void refresh();
    const unsubscribeChanged = realtime?.subscribe("module:remote-desktop:changed", () => { void refresh(); });
    const unsubscribeConnected = realtime?.subscribe("realtime:connected", () => { void refresh(); });
    return () => {
      controller.abort();
      unsubscribeChanged?.();
      unsubscribeConnected?.();
    };
  }, [departmentId, realtime, selectedDestinationId]);

  useEffect(() => () => {
    resizeObserverRef.current?.disconnect();
    if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
    clientRef.current?.disconnect();
  }, []);

  const connect = async (takeover = false) => {
    if (!displayRef.current || connecting || (connected && !takeover)) return;
    void setRemoteAudioPlayback(true).then(setAudioEnabled);
    if (takeover && role === "viewer") disconnect();
    setError("");
    setConnecting(true);
    try {
      const response = await fetch("/api/modules/remote-desktop/session", {
        method: "POST",
        headers: requestHeaders(departmentId, csrfToken),
        body: JSON.stringify({ destinationId: selectedDestinationId, ...currentDisplaySize(screenRef.current), ...(takeover ? { takeover: true } : {}) }),
      });
      const result = await readApiResponse<GuacSession>(response, "Could not open the Remote desktop session.");
      setRole(result.role);
      await loadGuacamoleClient(result.libraryUrl);
      const guac = window.Guacamole;
      if (!guac || !displayRef.current) throw new Error("The remote desktop client is unavailable.");
      if (guac.AudioContextFactory) {
        if (!guac.AudioContextFactory.singleton && remoteAudioContext) guac.AudioContextFactory.singleton = remoteAudioContext;
        remoteAudioContext = guac.AudioContextFactory.getAudioContext() ?? remoteAudioContext;
        setAudioEnabled(remoteAudioContext?.state === "running");
      }

      const tunnelUrl = new URL(result.tunnelUrl, window.location.href);
      tunnelUrl.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const tunnel = new guac.WebSocketTunnel(tunnelUrl.toString());
      const client = new guac.Client(tunnel);
      clientRef.current = client;
      client.onclipboard = (stream, mimetype) => {
        if (mimetype !== "text/plain") {
          stream.sendAck("Text clipboard only", 0x0100);
          return;
        }
        const reader = new guac.StringReader(stream);
        let text = "";
        reader.ontext = (chunk) => { text += chunk; };
        reader.onend = () => {
          setRemoteClipboard(text);
          if (autoClipboardSyncRef.current && navigator.clipboard?.writeText) {
            void navigator.clipboard.writeText(text).then(() => { lastClipboardSync.current = text; }).catch(() => setClipboardMessage("Allow clipboard access in your browser to use automatic sync."));
          }
        };
      };
      setAudioStreamStatus("");
      client.onaudio = (stream, mimetype) => {
        void stream;
        setAudioStreamStatus(mimetype);
        return null;
      };
      const display = client.getDisplay();
      const remoteDisplay = display.getElement();
      remoteDisplay.classList.add("system-laptop-guac-display");
      remoteDisplay.tabIndex = result.role === "controller" ? 0 : -1;
      displayRef.current.replaceChildren(remoteDisplay);
      if (result.role === "viewer") display.onresize = () => fitViewerDisplay(display, screenRef.current);

      if (result.role === "controller") {
        remoteDisplay.addEventListener("mousedown", () => remoteDisplay.focus({ preventScroll: true }));
        const keyboard = new guac.Keyboard(remoteDisplay);
        keyboard.onkeydown = (keysym) => client.sendKeyEvent(1, keysym);
        keyboard.onkeyup = (keysym) => client.sendKeyEvent(0, keysym);
        const mouse = new guac.Mouse(remoteDisplay);
        mouse.onmousedown = (state) => client.sendMouseState(state);
        mouse.onmouseup = (state) => client.sendMouseState(state);
        mouse.onmousemove = (state) => client.sendMouseState(state);
      }
      client.onstatechange = (state) => {
        if (state === 3) {
          setConnected(true);
          setConnecting(false);
          if (result.role === "controller") remoteDisplay.focus({ preventScroll: true });
          if (screenRef.current) {
            if (result.role === "viewer") {
              const fitDisplay = () => fitViewerDisplay(display, screenRef.current);
              resizeObserverRef.current?.disconnect();
              resizeObserverRef.current = new ResizeObserver(fitDisplay);
              resizeObserverRef.current.observe(screenRef.current);
              fitDisplay();
            }
            else {
              const sendCurrentSize = () => {
                if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
                resizeTimerRef.current = window.setTimeout(() => {
                  resizeTimerRef.current = null;
                  const size = currentDisplaySize(screenRef.current);
                  if (lastSizeRef.current?.width === size.width && lastSizeRef.current.height === size.height) return;
                  lastSizeRef.current = size;
                  client.sendSize(size.width, size.height);
                  void fetch("/api/modules/remote-desktop/size", {
                    method: "POST",
                    headers: requestHeaders(departmentId, csrfToken),
                    body: JSON.stringify({ ...size, proxyTicket: result.proxyTicket }),
                  }).then(async (sizeResponse) => {
                    await readApiResponse<{ width: number; height: number }>(sizeResponse, "Could not update the remote desktop size.");
                  }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not update the remote desktop size."));
                }, 180);
              };
              resizeObserverRef.current?.disconnect();
              resizeObserverRef.current = new ResizeObserver(sendCurrentSize);
              resizeObserverRef.current.observe(screenRef.current);
              sendCurrentSize();
            }
          }
        }
        else if (state === 5) { setConnected(false); setConnecting(false); }
      };
      client.onerror = (status) => {
        setError(status.message || "The remote desktop connection failed.");
        setConnecting(false);
      };

      const query = new URLSearchParams({
        token: result.authToken,
        GUAC_DATA_SOURCE: result.dataSource,
        GUAC_TYPE: "c",
        GUAC_ID: result.connectionId,
        GUAC_WIDTH: String(result.width),
        GUAC_HEIGHT: String(result.height),
        GUAC_DPI: "96",
        SC_PROXY_TICKET: result.proxyTicket,
      });
      for (const mimetype of guac.AudioPlayer.getSupportedTypes()) query.append("GUAC_AUDIO", mimetype);
      client.connect(query.toString());
    } catch (reason) {
      disconnect();
      setError(reason instanceof Error ? reason.message : "Could not connect to the Remote desktop.");
    }
  };

  const fullscreen = () => {
    const target = screenRef.current;
    if (target?.requestFullscreen) void target.requestFullscreen();
  };

  async function copyRemoteClipboard() {
    if (!navigator.clipboard?.writeText) { setClipboardMessage("Clipboard writing is not available in this browser."); return; }
    try {
      await navigator.clipboard.writeText(remoteClipboard);
      setClipboardMessage("Remote text copied to your clipboard.");
    } catch { setClipboardMessage("Allow clipboard access in your browser, then try again."); }
  }

  async function pasteLocalClipboard() {
    if (!navigator.clipboard?.readText) { setClipboardMessage("Clipboard reading is not available in this browser."); return; }
    try {
      const text = await navigator.clipboard.readText();
      setRemoteClipboard(text);
      sendClipboardToRemote(text);
      setClipboardMessage("Your clipboard was sent to the remote computer.");
    } catch { setClipboardMessage("Allow clipboard access in your browser, then try again."); }
  }

  return <section className="system-laptop-module">
    {error && <div className="system-laptop-error" role="alert"><WifiOff size={17} /><span>{error}</span></div>}
    {configured === false && !error && <div className="system-laptop-setup"><Laptop size={30} /><strong>{destinations.length ? "Choose a remote destination" : "Remote desktop is not configured"}</strong><p>{destinations.length ? "Select a destination to connect." : "Ask a server administrator to add a destination in Settings → Modules → Remote desktop destinations."}</p></div>}

    <section className="system-laptop-screen" aria-label="Remote desktop">
      <div className="system-laptop-toolbar"><div className="system-laptop-toolbar-title"><MonitorUp size={16} /><strong className="system-laptop-title">Remote desktop</strong>{destinations.length > 0 && <select className="remote-desktop-destination-picker" aria-label="Remote desktop destination" value={selectedDestinationId} disabled={connected || connecting} onChange={(event) => { disconnect(); setSelectedDestinationId(event.target.value); }}><option value="">Choose destination</option>{destinations.map((destination) => <option key={destination.id} value={destination.id}>{destination.name}</option>)}</select>}<span>{selectedDestination?.host ?? "Choose a destination"} · {connected ? role === "viewer" ? "View-only session" : "Live remote session" : "Remote screen"}</span></div><div className="system-laptop-toolbar-actions"><div className={`system-laptop-status ${connected ? "is-connected" : ""}`}><span />{connected ? (role === "viewer" ? "Watching" : "Controlling") : connecting ? "Connecting" : "Disconnected"}</div>{connected && <button className="button button-secondary" type="button" aria-label={audioEnabled ? "Mute remote audio" : "Unmute remote audio"} aria-pressed={audioEnabled} title={audioStreamStatus ? `RDP audio stream: ${audioStreamStatus}` : "Remote audio playback"} onClick={() => void setRemoteAudioPlayback(!audioEnabled).then(setAudioEnabled)}>{audioEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />} {audioEnabled ? "Audio on" : "Audio off"}</button>}{connected && role === "viewer" && canTakeOver && <button className="button button-secondary" type="button" title="Disconnect the current controller and take over the desktop" onClick={() => void connect(true)}><MonitorUp size={14} /> Take control</button>}{connected && <button className="button button-secondary" type="button" onClick={fullscreen}><Expand size={14} /> Full screen</button>}{(connected || connecting) && <button className="button button-secondary" type="button" onClick={disconnect}><LogOut size={14} /> Disconnect</button>}</div></div>
      {connected && <section className="remote-desktop-clipboard" aria-label="Clipboard"><textarea value={remoteClipboard} onChange={(event) => setRemoteClipboard(event.target.value)} aria-label="Remote clipboard text" placeholder="Remote clipboard text appears here" /><div className="remote-desktop-clipboard-actions"><button className="button button-secondary" type="button" onClick={() => void copyRemoteClipboard()}>Copy from remote</button><button className="button button-secondary" type="button" onClick={() => void pasteLocalClipboard()}>Paste to remote</button><label><input type="checkbox" checked={autoClipboardSync} onChange={(event) => { setClipboardMessage(""); setAutoClipboardSync(event.target.checked); }} /> Auto-sync this session</label></div>{clipboardMessage && <small role="status">{clipboardMessage}</small>}</section>}
      <div ref={screenRef} className={`system-laptop-display ${connected ? "system-laptop-display-live" : ""} ${connected && role === "viewer" ? "system-laptop-display-viewer" : ""}`}>
        <div className="system-laptop-guac-mount" ref={displayRef} />
        {configured && !connected && !connecting && selectedDestination && <div className="system-laptop-launch"><span className="system-laptop-launch-icon"><Laptop size={25} /></span><strong>{controllerActive ? `Active session · ${selectedDestination.name}` : controllerStarting ? "Controller is connecting" : controllerBusy ? "Another destination is in use" : canControl ? `Connect to ${selectedDestination.name}` : "Waiting for a controller"}</strong><p>{controllerActive ? "Watch in view-only mode, or take control and disconnect the current controller." : controllerStarting ? "The site administrator's session is starting. Try again shortly." : controllerBusy ? "Another remote desktop destination is currently being used." : canControl ? `Connect to ${selectedDestination.host} over ${selectedDestination.protocol.toUpperCase()}.` : "A site administrator must start this remote desktop. You can watch once the session is active."}</p>{controllerActive && <button className="button button-primary" type="button" onClick={() => void connect()}><MonitorUp size={15} /> Watch session</button>}{controllerActive && canTakeOver && <button className="button button-secondary" type="button" onClick={() => void connect(true)}><MonitorUp size={15} /> Take control</button>}{!controllerActive && canControl && !controllerStarting && !controllerBusy && <button className="button button-primary" type="button" onClick={() => void connect()}><MonitorUp size={15} /> Start remote session</button>}<small>{controllerActive ? "Taking control disconnects the current controller; viewers stay read-only." : controllerStarting ? "This module checks for the session automatically." : controllerBusy ? "Another destination is currently active." : canControl ? "Keyboard and mouse input go to the remote computer." : "This module checks for an active session automatically."}</small></div>}
        {connecting && <div className="system-laptop-launch"><LoaderCircle className="system-laptop-spinner" size={29} /><strong>Connecting to the AV computer…</strong><p>Remote sessions can take a few seconds to start.</p></div>}
        {connected && <div className="system-laptop-connected-label" aria-hidden="true">{role === "viewer" ? "Watching Remote desktop" : "Controlling Remote desktop"}</div>}
      </div>
    </section>
  </section>;
}
