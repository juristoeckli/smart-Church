import { useEffect, useState, type FormEvent } from "react";
import type { ServiceEventFactDefinition, ServiceEventFacts, ServiceEventFactsPeriod } from "@smart-church/contracts";

const definitionsPath = "/api/events/recorded-fact-definitions";
const numberPattern = "-?(?:0|[1-9][0-9]{0,8})(?:\\.[0-9]{1,3})?";

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

function ManageFactDefinitions({ departmentId, csrfToken, definitions, onChanged }: {
  departmentId: string; csrfToken: string; definitions: ServiceEventFactDefinition[]; onChanged: (field: ServiceEventFactDefinition) => void;
}) {
  const empty = { label: "", kind: "number", unit: "", options: "" } as const;
  const [draft, setDraft] = useState<{ label: string; kind: "number" | "select"; unit: string; options: string }>(empty);
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function change(field?: ServiceEventFactDefinition) {
    setError(""); setStatus(""); setBusy(true);
    const body = draft.kind === "number" ? { label: draft.label, kind: draft.kind, unit: draft.unit }
      : { label: draft.label, kind: draft.kind, options: draft.options.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) };
    try {
      const response = await fetch(field ? definitionsPath + "/" + field.id + "/archive" : definitionsPath, {
        method: "POST", headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken,
          ...(field ? {} : { "Content-Type": "application/json" }) },
        ...(field ? {} : { body: JSON.stringify(body) }),
      });
      onChanged(await readJson<ServiceEventFactDefinition>(response));
      if (!field) setDraft(empty);
      else setConfirmArchive("");
      setStatus(field ? "Fact archived." : "Fact added.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update the fact definition."); }
    finally { setBusy(false); }
  }

  return <details className="event-details-section">
    <summary>Manage custom facts</summary>
    <p>Fact labels, units and options stay with prior entries. Archive a fact to stop accepting new values.</p>
    <ul>{definitions.map((field) => <li key={field.id}>{field.label}{field.archivedAt ? " · Archived" : confirmArchive === field.id
      ? <><button className="button button-secondary" type="button" disabled={busy} onClick={() => void change(field)}>Confirm archive</button>
        <button className="button button-secondary" type="button" disabled={busy} onClick={() => setConfirmArchive("")}>Keep active</button></>
      : <button className="button button-secondary" type="button" disabled={busy} onClick={() => setConfirmArchive(field.id)}>Archive</button>}</li>)}</ul>
    <form onSubmit={(event) => { event.preventDefault(); void change(); }}>
      <fieldset disabled={busy}>
        <label>Fact name<input required maxLength={80} value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
        <label>Fact type<select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value === "select" ? "select" : "number" })}>
          <option value="number">Number</option><option value="select">Select</option>
        </select></label>
        {draft.kind === "number" ? <label>Unit (optional)<input maxLength={24} value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} /></label>
          : <label>Options (one per line)<textarea required maxLength={1620} value={draft.options} onChange={(event) => setDraft({ ...draft, options: event.target.value })} /></label>}
      </fieldset>
      <button className="button button-secondary" type="submit" disabled={busy}>Add fact</button>
    </form>
    {status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}
  </details>;
}

export function ServiceEventFactsPanel({ departmentId, csrfToken, eventId, eventDate }: {
  departmentId: string; csrfToken: string; eventId: string; eventDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [definitions, setDefinitions] = useState<ServiceEventFactDefinition[]>([]);
  const [definitionError, setDefinitionError] = useState("");
  const [custom, setCustom] = useState<Record<string, string | null>>({});
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
    void fetch(definitionsPath, { headers: { "x-department-id": departmentId }, signal: controller.signal })
      .then(readJson<{ definitions: ServiceEventFactDefinition[] }>).then((value) => {
        if (!controller.signal.aborted) { setDefinitions(value.definitions); setDefinitionError(""); }
      }).catch((failure: Error) => { if (!controller.signal.aborted) setDefinitionError(failure.message); });
    void fetch(endpoint, { headers: { "x-department-id": departmentId }, signal: controller.signal })
      .then(readJson<SavedFacts>).then((value) => {
        if (!controller.signal.aborted) { setEntry(value); setDraft(toDraft(value.facts)); setCustom({}); setError(""); }
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
      }, body: JSON.stringify({ ...facts, custom }) });
      const value = await readJson<SavedFacts>(response);
      setEntry(value);
      setDraft(toDraft(value.facts));
      setCustom({});
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
          {definitions.filter((field) => !field.archivedAt).map((field) => {
            const value = Object.hasOwn(custom, field.id) ? custom[field.id] ?? "" : entry.facts.custom?.[field.id] ?? "";
            const label = field.unit ? field.label + " (" + field.unit + ")" : field.label;
            return <label key={field.id}>{label}{field.kind === "number"
              ? <input inputMode="decimal" pattern={numberPattern} maxLength={14} value={value}
                onChange={(event) => setCustom({ ...custom, [field.id]: event.target.value || null })} />
              : <select value={value} onChange={(event) => setCustom({ ...custom, [field.id]: event.target.value || null })}>
                <option value="">No value</option>{field.options.map((option) => <option key={option}>{option}</option>)}
              </select>}
            </label>;
          })}
        </fieldset>
        {entry.editable ? <button type="submit" className="button button-secondary" disabled={saving}>{saving ? "Saving…" : "Save facts"}</button>
          : <p>Recorded facts are read-only for imported or cancelled events.</p>}
      </form> : !error && <p role="status">Loading event facts…</p>}
      {definitions.some((field) => field.archivedAt && entry?.facts.custom?.[field.id] !== undefined) && <dl>
        {definitions.filter((field) => field.archivedAt && entry?.facts.custom?.[field.id] !== undefined).map((field) => <div key={field.id}>
          <dt>{field.label} (archived)</dt><dd>{entry?.facts.custom?.[field.id]} {field.unit}</dd>
        </div>)}
      </dl>}
      {definitionError && <p role="alert">{definitionError}</p>}
      <ManageFactDefinitions departmentId={departmentId} csrfToken={csrfToken} definitions={definitions} onChanged={(field) => {
        setDefinitions((current) => [...current.filter((item) => item.id !== field.id), field].sort((a, b) => a.label.localeCompare(b.label)));
        setCustom((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== field.id)));
      }} />
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
      <label>Compare month<input type="month" min="1910-01" max="2999-12" value={period} onChange={(event) => setPeriod(event.target.value)} /></label>
      {summaryError && <p role="alert">{summaryError}</p>}
      {period && summary && <table><caption>Recorded facts compared with the same month last year</caption>
        <thead><tr><th scope="col">Month</th><th scope="col">Visitors</th><th scope="col">First-time visitors</th><th scope="col">Collection</th></tr></thead>
        <tbody>{summary.map((row) => <tr key={row.period}><th scope="row">{row.period}</th><td>{row.visitors ?? "—"}</td><td>{row.firstTimeVisitors ?? "—"}</td>
          <td>{row.collections.length > 0 ? row.collections.map(({ amount, currency }) => currency + " " + amount).join(" · ") : "—"}</td></tr>)}</tbody>
      </table>}
      {period && summary && definitions.some((field) => summary.some((row) => row.custom?.some(({ id }) => id === field.id))) && <table>
        <caption>Custom recorded facts by month</caption>
        <thead><tr><th scope="col">Fact</th>{summary.map((row) => <th key={row.period} scope="col">{row.period}</th>)}</tr></thead>
        <tbody>{definitions.filter((field) => summary.some((row) => row.custom?.some(({ id }) => id === field.id))).map((field) => <tr key={field.id}>
          <th scope="row">{field.label}{field.unit ? " (" + field.unit + ")" : ""}{field.archivedAt ? " (archived)" : ""}</th>
          {summary.map((row) => {
            const value = row.custom?.find(({ id }) => id === field.id);
            return <td key={row.period}>{value ? ("total" in value ? value.total : value.counts.map(({ value: option, count }) => option + " (" + count + ")").join(" · ")) : "—"}</td>;
          })}
        </tr>)}</tbody>
      </table>}
    </>}
  </details>;
}
