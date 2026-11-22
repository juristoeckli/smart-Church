import { useEffect, useState, type FormEvent } from "react";
import { CalendarEmbedCode } from "./CalendarEmbedCode";

type CalendarChoice = { id: string; name: string };
type Agenda = { id: string; name: string; calendars: CalendarChoice[] };
const endpoint = "/api/modules/church-calendar/public-agendas";

export function CalendarPublicAgendas({ departmentId, csrfToken, calendars }: {
  departmentId: string; csrfToken: string; calendars: CalendarChoice[];
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Agenda[]>([]);
  const [revision, setRevision] = useState(0);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [issued, setIssued] = useState<{ id: string; name: string; embedUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState("");
  const activeIds = calendars.map(({ id }) => id).join(",");
  const validSelection = selected.filter((id) => calendars.some((calendar) => calendar.id === id));

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoadError(false);
    fetch(endpoint, { headers: { "x-department-id": departmentId }, signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load public agendas.");
        const agendas = await response.json() as Agenda[];
        if (!controller.signal.aborted) setRows(agendas);
      })
      .catch(() => { if (!controller.signal.aborted) setLoadError(true); });
    return () => controller.abort();
  }, [activeIds, departmentId, open, revision]);

  async function mutate(method: "POST" | "DELETE", path = "", form?: { name: string; calendarIds: string[] }) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint + path, {
        method,
        headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken, ...(form ? { "content-type": "application/json" } : {}) },
        ...(form ? { body: JSON.stringify(form) } : {}),
      });
      const result = await response.json() as { id?: string; name?: string; embedUrl?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not update the public agenda.");
      if (result.id && result.name && result.embedUrl) setIssued({ id: result.id, name: result.name, embedUrl: result.embedUrl });
      if (method === "DELETE" && issued?.id === path.slice(1)) setIssued(null);
      if (form) { setName(""); setSelected([]); }
      setRevision((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the public agenda.");
    } finally { setBusy(false); }
  }

  function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || validSelection.length < 2) return;
    void mutate("POST", "", { name: name.trim(), calendarIds: validSelection });
  }

  return <details className="church-calendar-public-feed-settings" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Combined public agendas</summary>
    <p>Publish two or more calendars that already have public feeds.</p>
    {error && <p role="alert">{error}</p>}
    {loadError && <div role="alert">Could not load public agendas. <button type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button></div>}
    {calendars.length >= 2 && <form onSubmit={publish}>
      <label>Agenda name<input value={name} maxLength={120} required onChange={(event) => setName(event.target.value)} /></label>
      <fieldset><legend>Choose 2–8 calendars</legend>
        {calendars.map((calendar) => {
          const position = validSelection.indexOf(calendar.id);
          return <label key={calendar.id}><input type="checkbox" checked={position >= 0} disabled={busy || (validSelection.length >= 8 && position < 0)}
            onChange={(event) => { const checked = event.target.checked; setSelected((current) => checked ? [...current, calendar.id] : current.filter((id) => id !== calendar.id)); }} />
            {calendar.name}{position >= 0 ? ` (${position + 1})` : ""}
          </label>;
        })}
      </fieldset>
      <button type="submit" className="button button-primary" disabled={busy || !name.trim() || validSelection.length < 2}>Publish agenda</button>
    </form>}
    {rows.length > 0 && <ul>{rows.map((agenda) => <li key={agenda.id}>
      <strong>{agenda.name}</strong><p>{agenda.calendars.map(({ name }) => name).join(", ") || "No calendars currently published"}</p>
      <button type="button" className="church-calendar-feed-button" disabled={busy || !agenda.calendars.length} onClick={() => {
        if (window.confirm("Rotate this agenda link? Its previous website embed will stop working.")) void mutate("POST", `/${agenda.id}/rotate`);
      }}>Rotate link</button>
      <button type="button" className="church-calendar-feed-button" disabled={busy} onClick={() => {
        if (window.confirm("Revoke this agenda link? Its website embed will stop working.")) void mutate("DELETE", `/${agenda.id}`);
      }}>Revoke</button>
    </li>)}</ul>}
    {issued && <section aria-label="Published agenda embed"><strong>{issued.name}</strong><CalendarEmbedCode key={issued.embedUrl} url={issued.embedUrl} /></section>}
  </details>;
}
