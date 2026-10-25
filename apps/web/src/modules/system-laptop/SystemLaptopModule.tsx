import { useCallback, useEffect, useRef, useState } from "react";
import { Expand, Laptop, LoaderCircle, LogOut, MonitorUp, RefreshCw, ShieldCheck, WifiOff } from "lucide-react";
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
interface GuacClient {
  getDisplay(): { getElement(): HTMLElement; scale(factor: number): void };
  connect(data: string): void;
  disconnect(): void;
  sendSize(width: number, height: number): void;
  sendMouseState(state: GuacMouseState): void;
  sendKeyEvent(pressed: number, keysym: number): void;
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
declare global {
  interface Window {
    Guacamole?: {
      Client: new (tunnel: unknown) => GuacClient;
      WebSocketTunnel: new (url: string) => unknown;
      Mouse: new (element: HTMLElement) => GuacMouse;
      Keyboard: new (element: HTMLElement) => GuacKeyboard;
    };
  }
}

let guacScriptPromise: Promise<void> | null = null;
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

export function SystemLaptopModule({ departmentId, csrfToken }: { departmentId: string; csrfToken: string }) {
  const displayRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<GuacClient | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const lastSizeRef = useRef<{ width: number; height: number } | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [canControl, setCanControl] = useState(false);
  const [canTakeOver, setCanTakeOver] = useState(false);
  const [controllerActive, setControllerActive] = useState(false);
  const [controllerStarting, setControllerStarting] = useState(false);
  const [controllerBusy, setControllerBusy] = useState(false);
  const [role, setRole] = useState<"controller" | "viewer" | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");

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
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch("/api/modules/system-laptop/status", { headers: { "x-department-id": departmentId }, signal: controller.signal });
        const result = await readApiResponse<{ configured?: boolean; canControl?: boolean; canTakeOver?: boolean; controllerActive?: boolean; controllerStarting?: boolean; controllerBusy?: boolean }>(response, "Could not check System Laptop configuration.");
        setConfigured(Boolean(result.configured));
        setCanControl(Boolean(result.canControl));
        setCanTakeOver(Boolean(result.canTakeOver));
        setControllerActive(Boolean(result.controllerActive));
        setControllerStarting(Boolean(result.controllerStarting));
        setControllerBusy(Boolean(result.controllerBusy));
      } catch (reason) {
        if (!controller.signal.aborted) {
          setConfigured(false);
          setError(reason instanceof Error ? reason.message : "Could not check System Laptop configuration.");
        }
      }
    };
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 5000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [departmentId]);

  useEffect(() => () => {
    resizeObserverRef.current?.disconnect();
    if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
    clientRef.current?.disconnect();
  }, []);

  const connect = async (takeover = false) => {
    if (!displayRef.current || connecting || (connected && !takeover)) return;
    if (takeover && role === "viewer") disconnect();
    setError("");
    setConnecting(true);
    try {
      const response = await fetch("/api/modules/system-laptop/session", {
        method: "POST",
        headers: requestHeaders(departmentId, csrfToken),
        body: JSON.stringify({ ...currentDisplaySize(screenRef.current), ...(takeover ? { takeover: true } : {}) }),
      });
      const result = await readApiResponse<GuacSession>(response, "Could not open the System Laptop session.");
      setRole(result.role);
      await loadGuacamoleClient(result.libraryUrl);
      const guac = window.Guacamole;
      if (!guac || !displayRef.current) throw new Error("The remote desktop client is unavailable.");

      const tunnelUrl = new URL(result.tunnelUrl, window.location.href);
      tunnelUrl.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const tunnel = new guac.WebSocketTunnel(tunnelUrl.toString());
      const client = new guac.Client(tunnel);
      clientRef.current = client;
      const display = client.getDisplay();
      displayRef.current.replaceChildren(display.getElement());
      display.getElement().classList.add("system-laptop-guac-display");

      if (result.role === "controller") {
        const keyboard = new guac.Keyboard(display.getElement());
        keyboard.onkeydown = (keysym) => client.sendKeyEvent(1, keysym);
        keyboard.onkeyup = (keysym) => client.sendKeyEvent(0, keysym);
        const mouse = new guac.Mouse(display.getElement());
        mouse.onmousedown = (state) => client.sendMouseState(state);
        mouse.onmouseup = (state) => client.sendMouseState(state);
        mouse.onmousemove = (state) => client.sendMouseState(state);
      }
      client.onstatechange = (state) => {
        if (state === 3) {
          setConnected(true);
          setConnecting(false);
          if (result.role === "controller" && screenRef.current) {
            const sendCurrentSize = () => {
              if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
              resizeTimerRef.current = window.setTimeout(() => {
                resizeTimerRef.current = null;
                const size = currentDisplaySize(screenRef.current);
                if (lastSizeRef.current?.width === size.width && lastSizeRef.current.height === size.height) return;
                lastSizeRef.current = size;
                client.sendSize(size.width, size.height);
                void fetch("/api/modules/system-laptop/size", {
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
      client.connect(query.toString());
    } catch (reason) {
      disconnect();
      setError(reason instanceof Error ? reason.message : "Could not connect to the System Laptop.");
    }
  };

  const fullscreen = () => {
    const target = screenRef.current;
    if (target?.requestFullscreen) void target.requestFullscreen();
  };

  return <section className="system-laptop-module">
    <header className="system-laptop-heading">
      <div><span className="eyebrow">REMOTE CONTROL</span><h1>System Laptop</h1><p className="page-subtitle">Access the AV control computer and Dante Controller.</p></div>
      <div className={`system-laptop-status ${connected ? "is-connected" : ""}`}><span />{connected ? (role === "viewer" ? "Watching" : "Controlling") : connecting ? "Connecting" : "Disconnected"}</div>
    </header>

    <div className="system-laptop-security"><ShieldCheck size={17} /><p><strong>One controller, shared view</strong><span>A site administrator starts the session. Other users with module access can watch or take control; a transfer disconnects the previous controller. The RDP display follows the controller's screen size.</span></p></div>

    {error && <div className="system-laptop-error" role="alert"><WifiOff size={17} /><span>{error}</span></div>}
    {configured === false && !error && <div className="system-laptop-setup"><Laptop size={30} /><strong>Remote desktop is not configured</strong><p>Ask the server administrator to configure the System Laptop gateway and private RDP connection settings.</p></div>}

    <section className="system-laptop-screen" aria-label="System Laptop remote desktop">
      <div className="system-laptop-toolbar"><div><MonitorUp size={16} /><strong>AV control computer</strong><span>{connected ? role === "viewer" ? "View-only session" : "Live remote session" : "Remote screen"}</span></div><div>{connected && role === "viewer" && canTakeOver && <button className="button button-secondary" type="button" title="Disconnect the current controller and take over the desktop" onClick={() => void connect(true)}><MonitorUp size={14} /> Take control</button>}{connected && <button className="button button-secondary" type="button" onClick={fullscreen}><Expand size={14} /> Full screen</button>}{(connected || connecting) && <button className="button button-secondary" type="button" onClick={disconnect}><LogOut size={14} /> Disconnect</button>}</div></div>
      <div ref={screenRef} className={`system-laptop-display ${connected ? "system-laptop-display-live" : ""}`}>
        <div className="system-laptop-guac-mount" ref={displayRef} />
        {configured && !connected && !connecting && <div className="system-laptop-launch"><span className="system-laptop-launch-icon"><Laptop size={25} /></span><strong>{controllerActive ? "Active remote session" : controllerStarting ? "Controller is connecting" : controllerBusy ? "Remote desktop is in use" : canControl ? "Connect to the System Laptop" : "Waiting for a controller"}</strong><p>{controllerActive ? "Watch in view-only mode, or take control and disconnect the current controller." : controllerStarting ? "The site administrator's session is starting. Try again shortly." : controllerBusy ? "The single remote desktop is currently controlled from another location." : canControl ? "Open Dante Controller on the AV computer to view or change routes." : "A site administrator must start the remote desktop. You can watch once the session is active."}</p>{controllerActive && <button className="button button-primary" type="button" onClick={() => void connect()}><MonitorUp size={15} /> Watch session</button>}{controllerActive && canTakeOver && <button className="button button-secondary" type="button" onClick={() => void connect(true)}><MonitorUp size={15} /> Take control</button>}{!controllerActive && canControl && !controllerStarting && !controllerBusy && <button className="button button-primary" type="button" onClick={() => void connect()}><MonitorUp size={15} /> Start remote session</button>}<small>{controllerActive ? "Taking control disconnects the current controller; viewers stay read-only." : controllerStarting ? "This module checks for the session automatically." : controllerBusy ? "Only one location can use the remote desktop at a time." : canControl ? "Keyboard and mouse input go to the remote computer." : "This module checks for an active session automatically."}</small></div>}
        {connecting && <div className="system-laptop-launch"><LoaderCircle className="system-laptop-spinner" size={29} /><strong>Connecting to the AV computer…</strong><p>Remote sessions can take a few seconds to start.</p></div>}
        {connected && <div className="system-laptop-connected-label" aria-hidden="true">{role === "viewer" ? "Watching System Laptop" : "Controlling System Laptop"}</div>}
      </div>
    </section>
    <p className="system-laptop-footnote"><RefreshCw size={13} /> Close the session when finished. The Windows PC must remain powered on and connected to the Dante network.</p>
  </section>;
}
