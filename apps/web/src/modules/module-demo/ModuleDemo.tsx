import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Activity, Check, Clock3, CloudSun, LoaderCircle, MessageSquare, Plus, Puzzle, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import type { ModuleContext } from "../../module-registry";
import { translateModuleDemo } from "./translations";
import "./module-demo.css";

type DemoState = { counter: number; ideas: string[] };
type DemoEvent = { message?: unknown };
type DemoNote = { id: string; message: string; createdAt: string };
type WeatherResult = { place: string; country?: string; temperature: number; weatherCode: number; timeZone: string };
const emptyState: DemoState = { counter: 0, ideas: [] };

function weatherDescription(code: number, t: (key: string) => string) {
  if (code === 0) return t("weatherClear");
  if ([1, 2, 3].includes(code)) return t("weatherPartlyCloudy");
  if ([45, 48].includes(code)) return t("weatherFog");
  if ([51, 53, 55, 56, 57].includes(code)) return t("weatherDrizzle");
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return t("weatherRain");
  if ([71, 73, 75, 77, 85, 86].includes(code)) return t("weatherSnow");
  if ([95, 96, 99].includes(code)) return t("weatherThunderstorm");
  return t("weatherCurrent");
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

export function ModuleDemo({ department, departmentId, state, onStateChange, realtime, language, csrfToken, canManageSite }: ModuleContext) {
  const t = (key: string) => translateModuleDemo(language, key);
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
  const [notes, setNotes] = useState<DemoNote[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [notesLoading, setNotesLoading] = useState(true);
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesError, setNotesError] = useState("");
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
        setWeatherError(t("weatherError"));
      }
    };
    return () => { workerRef.current = null; worker.terminate(); };
  }, [language]);

  useEffect(() => realtime?.subscribe("module:module-demo:changed", (event) => {
    const payload = event.payload as DemoEvent | undefined;
    if (typeof payload?.message === "string") setLastEvent(payload.message);
  }), [realtime]);

  useEffect(() => {
    let active = true;
    setNotesLoading(true);
    const loadNotes = async () => {
      try {
        const response = await fetch("/api/modules/module-demo/notes", { headers: { "x-department-id": departmentId }, cache: "no-store" });
        const result = await response.json() as DemoNote[] | { error?: string };
        if (!response.ok || !Array.isArray(result)) throw new Error("error" in result ? result.error ?? t("notesLoadFailed") : t("notesLoadFailed"));
        if (active) { setNotes(result); setNotesError(""); }
      } catch {
        if (active) setNotesError(t("notesLoadFailed"));
      } finally { if (active) setNotesLoading(false); }
    };
    void loadNotes();
    const unsubscribe = realtime?.subscribe("module:module-demo:notes-changed", () => { void loadNotes(); });
    return () => { active = false; unsubscribe?.(); };
  }, [departmentId, realtime, language]);

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

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = noteDraft.trim();
    if (!message || notesSaving) return;
    setNotesSaving(true); setNotesError("");
    try {
      const response = await fetch("/api/modules/module-demo/notes", {
        method: "POST",
        headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify({ message }),
      });
      const result = await response.json() as DemoNote | { error?: string };
      if (!response.ok || !("id" in result)) throw new Error("error" in result ? result.error ?? t("notesSaveFailed") : t("notesSaveFailed"));
      setNotes((current) => [result, ...current.filter((note) => note.id !== result.id)].slice(0, 100));
      setNoteDraft("");
    } catch { setNotesError(t("notesSaveFailed")); }
    finally { setNotesSaving(false); }
  }

  async function deleteNote(noteId: string) {
    setNotesError("");
    try {
      const response = await fetch(`/api/modules/module-demo/notes/${noteId}`, { method: "DELETE", headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken } });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? t("notesDeleteFailed"));
      setNotes((current) => current.filter((note) => note.id !== noteId));
    } catch { setNotesError(t("notesDeleteFailed")); }
  }

  const canManageNotes = canManageSite || (department.permissions ?? []).includes("groups_manage");

  function sendDemoEvent() {
    const message = realtimeMessage.trim();
    if (!message) return;
    const sent = realtime?.send("module:module-demo:send", { message });
    setLastEvent(sent ? t("eventSent") : t("realtimeUnavailable"));
    if (sent) setRealtimeMessage("");
  }

  function loadWeather(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const city = weatherCity.trim();
    if (!city || city.length > 80) return;
    if (!workerRef.current) { setWeatherError(t("workerUnavailable")); return; }
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
      if (!response.ok || typeof result.utc !== "string") throw new Error(t("serverWorkerFailed"));
      setServerWorkerTime(result.utc);
    } catch (reason) {
      setServerWorkerError(t("serverWorkerFailed"));
    } finally { setServerWorkerLoading(false); }
  }

  return <div className="module-demo-page">
    <div className="module-demo-notice"><Sparkles size={15} /><span>{t("notice")}</span></div>
    <header className="module-demo-heading">
      <span className="module-demo-eyebrow">{t("eyebrow")}</span>
      <h1>{t("title")}</h1>
      <p>{t("subtitle")}</p>
    </header>

    <div className="module-demo-grid">
      <section className="module-demo-card" aria-labelledby="module-demo-counter-heading">
        <div className="module-demo-card-icon"><Check size={20} /></div>
        <div className="module-demo-card-content">
          <span className="module-demo-card-label">{t("clientState")}</span>
          <h2 id="module-demo-counter-heading">{t("stateTitle")}</h2>
          <p>{t("stateHelp")}</p>
          <div className="module-demo-counter-row">
            <output className="module-demo-count" aria-live="polite">{demoState.counter}</output>
            <button className="button button-primary" type="button" onClick={() => save({ ...demoState, counter: demoState.counter + 1 })}><Plus size={15} />{t("addOne")}</button>
            <button className="button button-secondary" type="button" onClick={() => save({ ...demoState, counter: 0 })} disabled={demoState.counter === 0}><RotateCcw size={15} />{t("reset")}</button>
          </div>
        </div>
      </section>

      <section className="module-demo-card" aria-labelledby="module-demo-ideas-heading">
        <div className="module-demo-card-icon"><Puzzle size={20} /></div>
        <div className="module-demo-card-content">
          <span className="module-demo-card-label">{t("formValidation")}</span>
          <h2 id="module-demo-ideas-heading">{t("ideaTitle")}</h2>
          <p>{t("ideaHelp")}</p>
          <form className="module-demo-idea-form" onSubmit={addIdea}>
            <input aria-label={t("ideaLabel")} maxLength={100} placeholder={t("ideaPlaceholder")} value={ideaDraft} onChange={(event) => setIdeaDraft(event.target.value)} />
            <button className="button button-primary" type="submit" disabled={!ideaDraft.trim() || demoState.ideas.length >= 20}><Plus size={15} />{t("addIdea")}</button>
          </form>
          {demoState.ideas.length ? <ul className="module-demo-idea-list">{demoState.ideas.map((idea, index) => <li key={`${idea}-${index}`}><span>{idea}</span><button type="button" aria-label={t("removeIdea").replace("{idea}", idea)} title={t("removeIdea").replace("{idea}", idea)} onClick={() => save({ ...demoState, ideas: demoState.ideas.filter((_, ideaIndex) => ideaIndex !== index) })}><Trash2 size={14} /></button></li>)}</ul> : <p className="module-demo-empty">{t("emptyIdeas")}</p>}
          <small className="module-demo-hint">{t("ideaCount").replace("{count}", String(demoState.ideas.length))}</small>
        </div>
      </section>

      <section className="module-demo-card module-demo-card-wide" aria-labelledby="module-demo-realtime-heading">
        <div className="module-demo-card-icon"><Activity size={20} /></div>
        <div className="module-demo-card-content">
          <span className="module-demo-card-label">{t("realtime")}</span>
          <h2 id="module-demo-realtime-heading">{t("eventTitle")}</h2>
          <p>{t("eventHelp")}</p>
          <div className="module-demo-realtime-form">
            <input aria-label={t("messageLabel")} maxLength={160} placeholder={t("messagePlaceholder")} value={realtimeMessage} onChange={(event) => setRealtimeMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); sendDemoEvent(); } }} />
            <button className="button button-primary" type="button" disabled={!realtimeMessage.trim()} onClick={sendDemoEvent}><MessageSquare size={15} />{t("sendEvent")}</button>
          </div>
          <div className="module-demo-event-output" aria-live="polite"><strong>{t("latestEvent")}</strong><span>{lastEvent || t("noEvent")}</span></div>
          <small className="module-demo-hint">{t("eventHint")}</small>
        </div>
      </section>

      <section className="module-demo-card module-demo-card-wide" aria-labelledby="module-demo-notes-heading">
        <div className="module-demo-card-icon"><Puzzle size={20} /></div>
        <div className="module-demo-card-content">
          <span className="module-demo-card-label">{t("database")}</span>
          <h2 id="module-demo-notes-heading">{t("notesTitle")}</h2>
          <p>{t("notesHelp")}</p>
          {canManageNotes && <form className="module-demo-idea-form" onSubmit={(event) => void addNote(event)}>
            <input aria-label={t("noteLabel")} maxLength={200} placeholder={t("notePlaceholder")} value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} />
            <button className="button button-primary" type="submit" disabled={!noteDraft.trim() || notesSaving}><Plus size={15} />{notesSaving ? t("savingNote") : t("saveNote")}</button>
          </form>}
          {notesError && <p className="module-demo-weather-error" role="alert">{notesError}</p>}
          {notesLoading ? <p className="module-demo-empty">{t("loadingNotes")}</p> : notes.length ? <ul className="module-demo-idea-list">{notes.map((note) => <li key={note.id}><span>{note.message}<small className="module-demo-note-date">{new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(note.createdAt))}</small></span>{canManageNotes && <button type="button" aria-label={t("deleteNote")} title={t("deleteNote")} onClick={() => void deleteNote(note.id)}><Trash2 size={14} /></button>}</li>)}</ul> : <p className="module-demo-empty">{t("emptyNotes")}</p>}
        </div>
      </section>

      <section className="module-demo-card module-demo-card-wide" aria-labelledby="module-demo-worker-heading">
        <div className="module-demo-card-icon"><CloudSun size={20} /></div>
        <div className="module-demo-card-content">
          <span className="module-demo-card-label">{t("worker")}</span>
          <h2 id="module-demo-worker-heading">{t("workerTitle")}</h2>
          <p>{t("workerHelp")}</p>
          <div className="module-demo-worker-grid">
            <div className="module-demo-worker-tile"><Clock3 size={17} /><span><small>{t("browserWorker").replace("{timeZone}", department.timeZone)}</small><strong>{workerClock ? new Intl.DateTimeFormat(language, { timeZone: department.timeZone, dateStyle: "medium", timeStyle: "medium" }).format(workerClock) : t("startingClock")}</strong></span></div>
            <div className="module-demo-weather">
              <form className="module-demo-weather-form" onSubmit={loadWeather}>
                <input aria-label={t("weatherCityLabel")} maxLength={80} placeholder={t("weatherCityPlaceholder")} value={weatherCity} onChange={(event) => setWeatherCity(event.target.value)} />
                <button className="button button-primary" type="submit" disabled={!weatherCity.trim() || weatherLoading}>{weatherLoading ? <LoaderCircle className="module-demo-spinner" size={15} /> : <CloudSun size={15} />}{weatherLoading ? t("loading") : t("getWeather")}</button>
              </form>
              {weatherError && <p className="module-demo-weather-error" role="alert">{weatherError}</p>}
              {weather && <div className="module-demo-weather-result" aria-live="polite"><strong>{weather.place}{weather.country ? `, ${weather.country}` : ""}</strong><span>{weatherDescription(weather.weatherCode, t)} · {weather.temperature.toFixed(1)} °C</span></div>}
              <small className="module-demo-hint">{t("weatherHint")}</small>
            </div>
          </div>
          <div className="module-demo-server-worker">
            <div className="module-demo-server-worker-copy"><strong>{t("serverWorker")}</strong><span>{t("serverWorkerHelp")}</span>{serverWorkerTime && <output aria-live="polite">{t("workerReply").replace("{time}", serverWorkerTime)}</output>}{serverWorkerError && <span className="module-demo-weather-error" role="alert">{serverWorkerError}</span>}</div>
            <button className="button button-primary" type="button" onClick={() => void requestServerWorkerTime()} disabled={serverWorkerLoading}>{serverWorkerLoading ? <LoaderCircle className="module-demo-spinner" size={15} /> : <Clock3 size={15} />}{serverWorkerLoading ? t("askingWorker") : t("askWorker")}</button>
          </div>
        </div>
      </section>
    </div>
    <footer className="module-demo-footer">{t("footer")}</footer>
  </div>;
}
