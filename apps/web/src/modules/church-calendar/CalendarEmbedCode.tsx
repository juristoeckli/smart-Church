import { useState } from "react";

export function CalendarEmbedCode({ url }: { url: string }) {
  const [days, setDays] = useState(60);
  const [entries, setEntries] = useState(20);
  const [searchEntry, setSearchEntry] = useState("");
  const [feedback, setFeedback] = useState("");
  const source = new URL(url, window.location.origin);
  source.searchParams.set("days", String(days));
  source.searchParams.set("entries", String(entries));
  if (searchEntry.trim()) source.searchParams.set("searchEntry", searchEntry.trim());
  const code = `<iframe src="${source.toString().replaceAll("&", "&amp;").replaceAll('"', "&quot;")}" title="Church calendar" width="100%" height="500" loading="lazy" sandbox referrerpolicy="no-referrer"></iframe>`;

  async function copy() {
    try { await navigator.clipboard.writeText(code); setFeedback("Embed code copied."); }
    catch { setFeedback("Select and copy the embed code."); }
  }

  return <details className="church-calendar-web-embed">
    <summary>Embed on a website</summary>
    <label>Show upcoming<select value={days} onChange={(event) => setDays(Number(event.target.value))}>
      <option value={30}>30 days</option><option value={60}>60 days</option><option value={90}>90 days</option><option value={120}>120 days</option>
    </select></label>
    <label>Limit appointments<select value={entries} onChange={(event) => setEntries(Number(event.target.value))}>
      <option value={10}>10</option><option value={20}>20</option><option value={30}>30</option><option value={50}>50</option>
    </select></label>
    <label>Filter by search terms<input type="search" maxLength={240} value={searchEntry} onChange={(event) => {
      setSearchEntry(event.target.value); setFeedback("");
    }} /><small>Separate terms with commas. An appointment appears if its title, subtitle or place matches any term.</small></label>
    <label>Website embed code<textarea rows={4} value={code} readOnly onFocus={(event) => event.target.select()} /></label>
    <div className="church-calendar-feed-actions">
      <a href={source.toString()} target="_blank" rel="noreferrer">Preview public agenda</a>
      <button type="button" className="church-calendar-feed-button" onClick={() => void copy()}>Copy embed code</button>
    </div>
    {feedback && <p role="status">{feedback}</p>}
  </details>;
}
