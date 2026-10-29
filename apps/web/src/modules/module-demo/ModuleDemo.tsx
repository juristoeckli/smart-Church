import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Activity, Check, Clock3, CloudSun, LoaderCircle, MessageSquare, Plus, Puzzle, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import type { ModuleContext } from "../../module-registry";
import "./module-demo.css";

type DemoState = { counter: number; ideas: string[] };
type DemoEvent = { message?: unknown };
type WeatherResult = { place: string; country?: string; temperature: number; weatherCode: number; timeZone: string };
const emptyState: DemoState = { counter: 0, ideas: [] };

function weatherDescription(code: number) {
  if (code === 0) return "Clear sky";
  if ([1, 2, 3].includes(code)) return "Partly cloudy";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return "Current conditions";
}

function readState(value: string): DemoState {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const candidate = parsed as Partial<DemoState>;
      return {
        counter: Number.isSafeInteger(candidate.counter) && (candidate.counter ?? -1) >= 0 ? candidate.counter! : 0,
        ideas: Array.isArray(candidate.ideas) ? candidate.ideas.filter((idea): idea is string => typeof idea === "string").slice(0, 20) : [],
      };
    }
  } catch { /* Migrate the earlier counter-only demo state below. */ }
  const oldCounter = Number.parseInt(value, 10);
  return Number.isSafeInteger(oldCounter) && oldCounter >= 0 ? { ...emptyState, counter: oldCounter } : emptyState;
}

export function ModuleDemo({ department, departmentId, state, onStateChange, realtime }: ModuleContext) {
  const demoState = useMemo(() => readState(state), [state]);
  const [ideaDraft, setIdeaDraft] = useState("");
  const [realtimeMessage, setRealtimeMessage] = useState("");
  const [lastEvent, setLastEvent] = useState("");
  const [workerClock, setWorkerClock] = useState<Date | null>(null);
  const [weatherCity, setWeatherCity] = useState("");
  const [weather, setWeather] = useState<WeatherResult | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState("");
  const [serverWorkerTime, setServerWorkerTime] = useState("");
  const [serverWorkerLoading, setServerWorkerLoading] = useState(false);
  const [serverWorkerError, setServerWorkerError] = useState("");
  const weatherRequestId = useRef(0);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL("./module-demo.worker.js", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<{ type: string; now?: string; requestId?: number; result?: WeatherResult; error?: string }>) => {
      const message = event.data;
      if (message.type === "clock" && message.now) {
        const date = new Date(message.now);
        if (Number.isFinite(date.getTime())) setWorkerClock(date);
      }
      if (message.requestId !== weatherRequestId.current) return;
      if (message.type === "weather-result") {
        setWeather(message.result ?? null);
        setWeatherLoading(false);
        setWeatherError("");
      } else if (message.type === "weather-error") {
        setWeatherLoading(false);
        setWeatherError(message.error ?? "Weather data could not be loaded.");
      }
    };
    return () => { workerRef.current = null; worker.terminate(); };
  }, []);

  useEffect(() => realtime?.subscribe("module:module-demo:changed", (event) => {
    const payload = event.payload as DemoEvent | undefined;
    if (typeof payload?.message === "string") setLastEvent(payload.message);
  }), [realtime]);

  function save(next: DemoState) {
    onStateChange(JSON.stringify(next));
  }

  function addIdea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const idea = ideaDraft.trim();
    if (!idea || idea.length > 100 || demoState.ideas.length >= 20) return;
    save({ ...demoState, ideas: [...demoState.ideas, idea] });
    setIdeaDraft("");
  }

  function sendDemoEvent() {
    const message = realtimeMessage.trim();
    if (!message) return;
    const sent = realtime?.send("module:module-demo:send", { message });
    setLastEvent(sent ? "Sent. Open this module in another tab to see the event arrive there." : "Realtime is not connected. Reconnect to the server and try again.");
    if (sent) setRealtimeMessage("");
  }

  function loadWeather(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const city = weatherCity.trim();
    if (!city || city.length > 80) return;
    if (!workerRef.current) { setWeatherError("The module worker is not available."); return; }
    weatherRequestId.current += 1;
    setWeatherLoading(true);
    setWeatherError("");
    workerRef.current.postMessage({ type: "weather", city, requestId: weatherRequestId.current });
  }

  async function requestServerWorkerTime() {
    setServerWorkerLoading(true);
    setServerWorkerError("");
    try {
      const response = await fetch("/api/modules/module-demo/worker/time", { headers: { "x-department-id": departmentId }, cache: "no-store" });
      const result = await response.json() as { utc?: string; error?: string };
      if (!response.ok || typeof result.utc !== "string") throw new Error(result.error ?? "The module's server worker could not return the time.");
      setServerWorkerTime(result.utc);
    } catch (reason) {
      setServerWorkerError(reason instanceof Error ? reason.message : "The module's server worker could not return the time.");
    } finally { setServerWorkerLoading(false); }
  }

  return <div className="module-demo-page">
    <div className="module-demo-notice"><Sparkles size={15} /><span>A hands-on example for developers building self-contained Smart-Church modules.</span></div>
    <header className="module-demo-heading">
      <span className="module-demo-eyebrow">MODULE AUTHORING PLAYGROUND</span>
      <h1>Module Demo</h1>
      <p>Explore common module patterns in an interactive sandbox. Each example is implemented inside this module.</p>
    </header>

    <div className="module-demo-grid">
      <section className="module-demo-card" aria-labelledby="module-demo-counter-heading">
        <div className="module-demo-card-icon"><Check size={20} /></div>
        <div className="module-demo-card-content">
          <span className="module-demo-card-label">CLIENT STATE</span>
          <h2 id="module-demo-counter-heading">Keep module-specific state</h2>
          <p>Use the module state callback for small UI state. Smart-Church saves it per module and location, separately from core settings.</p>
          <div className="module-demo-counter-row">
            <output className="module-demo-count" aria-live="polite">{demoState.counter}</output>
            <button className="button button-primary" type="button" onClick={() => save({ ...demoState, counter: demoState.counter + 1 })}><Plus size={15} />Add one</button>
            <button className="button button-secondary" type="button" onClick={() => save({ ...demoState, counter: 0 })} disabled={demoState.counter === 0}><RotateCcw size={15} />Reset</button>
          </div>
        </div>
      </section>

      <section className="module-demo-card" aria-labelledby="module-demo-ideas-heading">
        <div className="module-demo-card-icon"><Puzzle size={20} /></div>
        <div className="module-demo-card-content">
          <span className="module-demo-card-label">FORM + VALIDATION</span>
          <h2 id="module-demo-ideas-heading">Collect a module idea</h2>
          <p>Build a small feature with a controlled form, input limits, an empty state, and editable saved items.</p>
          <form className="module-demo-idea-form" onSubmit={addIdea}>
            <input aria-label="Module idea" maxLength={100} placeholder="e.g. volunteer rota" value={ideaDraft} onChange={(event) => setIdeaDraft(event.target.value)} />
            <button className="button button-primary" type="submit" disabled={!ideaDraft.trim() || demoState.ideas.length >= 20}><Plus size={15} />Add idea</button>
          </form>
          {demoState.ideas.length ? <ul className="module-demo-idea-list">{demoState.ideas.map((idea, index) => <li key={`${idea}-${index}`}><span>{idea}</span><button type="button" aria-label={`Remove ${idea}`} title="Remove idea" onClick={() => save({ ...demoState, ideas: demoState.ideas.filter((_, ideaIndex) => ideaIndex !== index) })}><Trash2 size={14} /></button></li>)}</ul> : <p className="module-demo-empty">Your saved ideas will appear here.</p>}
          <small className="module-demo-hint">{demoState.ideas.length}/20 ideas · 100 characters each · saved with module state</small>
        </div>
      </section>

      <section className="module-demo-card module-demo-card-wide" aria-labelledby="module-demo-realtime-heading">
        <div className="module-demo-card-icon"><Activity size={20} /></div>
        <div className="module-demo-card-content">
          <span className="module-demo-card-label">REALTIME EVENTS</span>
          <h2 id="module-demo-realtime-heading">Send a module event</h2>
          <p>Send a module-owned event through the shared authenticated WebSocket. Open this page in another tab and send a message to see it update live.</p>
          <div className="module-demo-realtime-form">
            <input aria-label="Realtime demo message" maxLength={160} placeholder="Write a short message…" value={realtimeMessage} onChange={(event) => setRealtimeMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); sendDemoEvent(); } }} />
            <button className="button button-primary" type="button" disabled={!realtimeMessage.trim()} onClick={sendDemoEvent}><MessageSquare size={15} />Send event</button>
          </div>
          <div className="module-demo-event-output" aria-live="polite"><strong>Latest event</strong><span>{lastEvent || "No event received yet."}</span></div>
          <small className="module-demo-hint">Events are temporary notifications, not saved data. Keep the event names and handler with your module.</small>
        </div>
      </section>

      <section className="module-demo-card module-demo-card-wide" aria-labelledby="module-demo-worker-heading">
        <div className="module-demo-card-icon"><CloudSun size={20} /></div>
        <div className="module-demo-card-content">
          <span className="module-demo-card-label">BACKGROUND WORKER</span>
          <h2 id="module-demo-worker-heading">Run module-owned workers</h2>
          <p>This module demonstrates both a browser Web Worker and a separate server-side worker process.</p>
          <div className="module-demo-worker-grid">
            <div className="module-demo-worker-tile"><Clock3 size={17} /><span><small>BROWSER WORKER · LOCATION TIME · {department.timeZone}</small><strong>{workerClock ? new Intl.DateTimeFormat(undefined, { timeZone: department.timeZone, dateStyle: "medium", timeStyle: "medium" }).format(workerClock) : "Starting clock…"}</strong></span></div>
            <div className="module-demo-weather">
              <form className="module-demo-weather-form" onSubmit={loadWeather}>
                <input aria-label="City for weather lookup" maxLength={80} placeholder="City, e.g. Bern" value={weatherCity} onChange={(event) => setWeatherCity(event.target.value)} />
                <button className="button button-primary" type="submit" disabled={!weatherCity.trim() || weatherLoading}>{weatherLoading ? <LoaderCircle className="module-demo-spinner" size={15} /> : <CloudSun size={15} />}{weatherLoading ? "Loading…" : "Get weather"}</button>
              </form>
              {weatherError && <p className="module-demo-weather-error" role="alert">{weatherError}</p>}
              {weather && <div className="module-demo-weather-result" aria-live="polite"><strong>{weather.place}{weather.country ? `, ${weather.country}` : ""}</strong><span>{weatherDescription(weather.weatherCode)} · {weather.temperature.toFixed(1)} °C</span></div>}
              <small className="module-demo-hint">Current conditions from Open-Meteo. The city name is sent there only when you submit the lookup.</small>
            </div>
          </div>
          <div className="module-demo-server-worker">
            <div className="module-demo-server-worker-copy"><strong>Server worker · UTC clock</strong><span>Ask the module's separate Node process for the current time. Its status, memory, and uptime appear in Settings.</span>{serverWorkerTime && <output aria-live="polite">Worker replied: {serverWorkerTime}</output>}{serverWorkerError && <span className="module-demo-weather-error" role="alert">{serverWorkerError}</span>}</div>
            <button className="button button-primary" type="button" onClick={() => void requestServerWorkerTime()} disabled={serverWorkerLoading}>{serverWorkerLoading ? <LoaderCircle className="module-demo-spinner" size={15} /> : <Clock3 size={15} />}{serverWorkerLoading ? "Asking worker…" : "Ask server worker"}</button>
          </div>
        </div>
      </section>
    </div>
    <footer className="module-demo-footer">These examples use the module SDK; the demo does not change church data.</footer>
  </div>;
}
