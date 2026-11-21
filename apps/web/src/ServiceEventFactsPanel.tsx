import { useEffect, useState, type FormEvent } from "react";
import type { ServiceEventFacts, ServiceEventFactsPeriod } from "@smart-church/contracts";

type SavedFacts = { facts: ServiceEventFacts; editable: boolean };
type Draft = { visitors: string; firstTimeVisitors: string; amount: string; currency: string };

function toDraft(facts: ServiceEventFacts): Draft {
  return { visitors: String(facts.visitors ?? ""), firstTimeVisitors: String(facts.firstTimeVisitors ?? ""),
    amount: facts.collection?.amount ?? "", currency: facts.collection?.currency ?? "" };
}

async function readJson<T>(response: Response): Promise<T> {
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Event facts are unavailable.");
  return result;
}

export function ServiceEventFactsPanel({ departmentId, csrfToken, eventId, eventDate }: {
  departmentId: string; csrfToken: string; eventId: string; eventDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [entry, setEntry] = useState<SavedFacts>();
  const [draft, setDraft] = useState(() => toDraft({}));
  const [period, setPeriod] = useState(eventDate.slice(0, 7));
  const [summary, setSummary] = useState<ServiceEventFactsPeriod[]>();
  const [summaryError, setSummaryError] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const endpoint = "/api/events/" + eventId + "/recorded-facts";

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetch(endpoint, { headers: { "x-department-id": departmentId }, signal: controller.signal })
      .then(readJson<SavedFacts>).then((value) => {
        if (!controller.signal.aborted) { setEntry(value); setDraft(toDraft(value.facts)); setError(""); }
      }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [departmentId, endpoint, open]);

  useEffect(() => {
    setSummary(undefined);
    setSummaryError("");
    if (!open || !period) return;
    const controller = new AbortController();
    void fetch("/api/events/recorded-facts-summary?period=" + encodeURIComponent(period),
      { headers: { "x-department-id": departmentId }, signal: controller.signal })
      .then(readJson<{ periods: ServiceEventFactsPeriod[] }>).then((value) => {
        if (!controller.signal.aborted) setSummary(value.periods);
      }).catch((failure: Error) => { if (!controller.signal.aborted) setSummaryError(failure.message); });
    return () => controller.abort();
  }, [departmentId, open, period, revision]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!entry?.editable || saving) return;
    setStatus(""); setError(""); setSaving(true);
    const facts: ServiceEventFacts = {
      ...(draft.visitors ? { visitors: Number(draft.visitors) } : {}),
      ...(draft.firstTimeVisitors ? { firstTimeVisitors: Number(draft.firstTimeVisitors) } : {}),
      ...(draft.amount && draft.currency ? { collection: { amount: draft.amount.trim(), currency: draft.currency.trim().toUpperCase() } } : {}),
    };
    try {
      const response = await fetch(endpoint, { method: "PUT", headers: {
        "Content-Type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken,
      }, body: JSON.stringify(facts) });
      const value = await readJson<SavedFacts>(response);
      setEntry(value);
      setDraft(toDraft(value.facts));
      setStatus("Event facts saved.");
      setRevision((version) => version + 1);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save event facts."); }
    finally { setSaving(false); }
  }

  return <details className="event-details-section directory-card" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Recorded event facts</summary>
    {open && <>
      <p>Enter visitor counts and collections recorded at the event. Collection figures are for event reporting.</p>
      {entry ? <form onSubmit={(event) => void save(event)}>
        <fieldset disabled={!entry.editable || saving}>
          <div className="form-row">
            <label>Visitors<input type="number" min={0} max={1_000_000} step={1} value={draft.visitors} onChange={(event) => setDraft({ ...draft, visitors: event.target.value })} /></label>
            <label>First-time visitors<input type="number" min={0} max={1_000_000} step={1} value={draft.firstTimeVisitors} onChange={(event) => setDraft({ ...draft, firstTimeVisitors: event.target.value })} /></label>
          </div>
          <div className="form-row">
            <label>Collection amount<input inputMode="decimal" pattern={"(?:0|[1-9][0-9]{0,8})(?:\\.[0-9]{1,3})?"} required={!!draft.currency} maxLength={13} value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></label>
            <label>Collection currency<input pattern="[A-Za-z]{3}" placeholder="CHF" maxLength={3} required={!!draft.amount} value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value })} /></label>
          </div>
        </fieldset>
        {entry.editable ? <button type="submit" className="button button-secondary" disabled={saving}>{saving ? "Saving…" : "Save facts"}</button>
          : <p>Recorded facts are read-only for imported or cancelled events.</p>}
      </form> : !error && <p role="status">Loading event facts…</p>}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
      <label>Compare month<input type="month" min="1910-01" max="2999-12" value={period} onChange={(event) => setPeriod(event.target.value)} /></label>
      {summaryError && <p role="alert">{summaryError}</p>}
      {period && summary && <table><caption>Recorded facts compared with the same month last year</caption>
        <thead><tr><th scope="col">Month</th><th scope="col">Visitors</th><th scope="col">First-time visitors</th><th scope="col">Collection</th></tr></thead>
        <tbody>{summary.map((row) => <tr key={row.period}><th scope="row">{row.period}</th><td>{row.visitors ?? "—"}</td><td>{row.firstTimeVisitors ?? "—"}</td>
          <td>{row.collections.length > 0 ? row.collections.map(({ amount, currency }) => currency + " " + amount).join(" · ") : "—"}</td></tr>)}</tbody>
      </table>}
    </>}
  </details>;
}
