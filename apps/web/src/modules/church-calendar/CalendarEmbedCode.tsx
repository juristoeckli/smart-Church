import { useState } from "react";

function escapeAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

type CalendarChoice = { id: string; name: string };

export function CalendarEmbedCode({ url, calendars }: { url: string; calendars?: CalendarChoice[] }) {
  const [view, setView] = useState("eventView");
  const [period, setPeriod] = useState("month");
  const [days, setDays] = useState(60);
  const [entries, setEntries] = useState(20);
  const [searchEntry, setSearchEntry] = useState("");
  const [title, setTitle] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [availableIds, setAvailableIds] = useState<string[] | null>(null);
  const [defaultIds, setDefaultIds] = useState<string[] | null>(null);
  const [feedback, setFeedback] = useState("");
  const available = calendars?.filter(({ id }) => !availableIds || availableIds.includes(id)) ?? [];
  const defaults = available.length < 2 ? available : available.filter(({ id }) => !defaultIds || defaultIds.includes(id));
  const source = new URL(url, window.location.origin);
  if (view === "calView") {
    source.searchParams.set("viewname", view);
    source.searchParams.set("period", period);
  } else {
    source.searchParams.set("days", String(days));
    source.searchParams.set("entries", String(entries));
    if (searchEntry.trim()) source.searchParams.set("searchEntry", searchEntry.trim());
  }
  if (availableIds?.length) source.searchParams.set("category_id", availableIds.join(","));
  if (defaults.length !== available.length) source.searchParams.set("category_select", defaults.map(({ id }) => id).join(","));
  const customTitle = title.trim();
  if (customTitle) source.searchParams.set("title", customTitle);
  if (darkMode) source.searchParams.set("darkmode", "true");
  const code = `<iframe src="${escapeAttribute(source.toString())}" title="${escapeAttribute(customTitle || "Church calendar")}" width="100%" height="500" loading="lazy" sandbox referrerpolicy="no-referrer"></iframe>`;

  async function copy() {
    try { await navigator.clipboard.writeText(code); setFeedback("Embed code copied."); }
    catch { setFeedback("Select and copy the embed code."); }
  }

  return <details className="church-calendar-web-embed">
    <summary>Embed on a website</summary>
    <label>View<select value={view} onChange={(event) => { setView(event.target.value); setFeedback(""); }}>
      <option value="eventView">Appointment list</option><option value="calView">Calendar grid</option>
    </select></label>
    {view === "calView" ? <label>Initial calendar view<select value={period} onChange={(event) => {
      setPeriod(event.target.value); setFeedback("");
    }}>
      <option value="month">Month</option><option value="week">Week</option><option value="day">Day</option>
    </select></label> : <>
      <label>Show upcoming<select value={days} onChange={(event) => setDays(Number(event.target.value))}>
        <option value={30}>30 days</option><option value={60}>60 days</option><option value={90}>90 days</option><option value={120}>120 days</option>
      </select></label>
      <label>Limit appointments<select value={entries} onChange={(event) => setEntries(Number(event.target.value))}>
        <option value={10}>10</option><option value={20}>20</option><option value={30}>30</option><option value={50}>50</option>
      </select></label>
      <label>Filter by search terms<input type="search" maxLength={240} value={searchEntry} onChange={(event) => {
        setSearchEntry(event.target.value); setFeedback("");
      }} /><small>Separate terms with commas. An appointment appears if its title, subtitle or place matches any term.</small></label>
    </>}
    {calendars && calendars.length > 1 && <fieldset>
      <legend>Calendars visitors can choose</legend>
      {calendars.map(({ id, name }) => {
        const checked = available.some((option) => option.id === id);
        return <label key={id}><input type="checkbox" checked={checked} disabled={checked && available.length === 1}
          onChange={(event) => {
            setAvailableIds(event.target.checked ? [...available.map((option) => option.id), id] : available.filter((option) => option.id !== id).map((option) => option.id));
            setFeedback("");
          }} /> {name}</label>;
      })}
    </fieldset>}
    {available.length > 1 && <fieldset>
      <legend>Calendars shown initially</legend>
      {available.map(({ id, name }) => <label key={id}><input type="checkbox" checked={defaults.some((option) => option.id === id)}
        onChange={(event) => {
          setDefaultIds(event.target.checked ? [...defaults.map((option) => option.id), id] : defaults.filter((option) => option.id !== id).map((option) => option.id));
          setFeedback("");
        }} /> {name}</label>)}
    </fieldset>}
    <label>Display title<input type="text" maxLength={120} value={title} onChange={(event) => {
      setTitle(event.target.value); setFeedback("");
    }} placeholder="Use the calendar or agenda name" /></label>
    <label className="church-calendar-check"><input type="checkbox" checked={darkMode} onChange={(event) => {
      setDarkMode(event.target.checked); setFeedback("");
    }} /> Force dark mode</label>
    <label>Website embed code<textarea rows={4} value={code} readOnly onFocus={(event) => event.target.select()} /></label>
    <div className="church-calendar-feed-actions">
      <a href={source.toString()} target="_blank" rel="noreferrer">Preview public agenda</a>
      <button type="button" className="church-calendar-feed-button" onClick={() => void copy()}>Copy embed code</button>
    </div>
    {feedback && <p role="status">{feedback}</p>}
  </details>;
}
