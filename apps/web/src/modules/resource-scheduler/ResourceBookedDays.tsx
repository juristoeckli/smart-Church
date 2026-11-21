import { useEffect, useState, type FormEvent } from "react";

type DateRange = { from: string; through: string };
type Report = DateRange & {
  timeZone: string;
  calendarDays: number;
  resources: { id: string; name: string; category: string; location: string; confirmedDays: number; pendingOnlyDays: number }[];
};

function todayIn(timeZone: string) {
  const instant = new Date();
  let parts: Intl.DateTimeFormatPart[];
  try { parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant); }
  catch { return instant.toISOString().slice(0, 10); }
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value).join("-");
}

function addDays(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function ResourceBookedDays({ departmentId, timeZone, resourceId, category, markedOnly, refreshVersion }: {
  departmentId: string;
  timeZone: string;
  resourceId?: string;
  category?: string;
  markedOnly: boolean;
  refreshVersion: number;
}) {
  const today = todayIn(timeZone);
  const [draft, setDraft] = useState<DateRange>(() => ({ from: addDays(today, -89), through: today }));
  const [range, setRange] = useState(draft);
  const [requestVersion, setRequestVersion] = useState(0);
  const [report, setReport] = useState<{ scope: string; data: Report } | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const query = new URLSearchParams({ ...range, ...(resourceId ? { resourceId } : {}), ...(category ? { category } : {}), markedOnly: String(markedOnly) }).toString();
  const scope = `${departmentId}|${query}|${refreshVersion}|${requestVersion}`;

  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/modules/resource-scheduler/booked-days?${query}`, {
          signal: abort.signal, headers: { "x-department-id": departmentId },
        });
        const payload = await response.json() as Report & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Could not load booked days.");
        if (!abort.signal.aborted) setReport({ scope, data: payload });
      } catch (error) {
        if (!abort.signal.aborted) setFailure({ scope, message: error instanceof Error ? error.message : "Could not load booked days." });
      }
    })();
    return () => abort.abort();
  }, [departmentId, query, scope]);

  function choose(range: DateRange) {
    setReport(null);
    setFailure(null);
    setDraft(range);
    setRange(range);
    setRequestVersion((version) => version + 1);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    choose(draft);
  }

  const data = report?.scope === scope ? report.data : null;
  const error = failure?.scope === scope ? failure.message : "";
  return <section className="resource-scheduler-booked-days" aria-labelledby="resource-booked-days-title">
    <h2 id="resource-booked-days-title">Booked days by resource</h2>
    <p>Each date counts once per resource. Pending-only dates have requests but no confirmed booking.</p>
    <div className="resource-scheduler-week" role="group" aria-label="Booked day date presets">
      {([
        ["Past 90 days", 0], ["Through next 90 days", 90], ["Through next year", 365],
      ] as const).map(([label, days]) => <button key={label} type="button" className="button button-secondary"
        onClick={() => choose({ from: addDays(today, -89), through: addDays(today, days) })}>{label}</button>)}
    </div>
    <form className="resource-scheduler-filters" onSubmit={submit}>
      <label>From<input type="date" required value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label>
      <label>Through<input type="date" required min={draft.from} value={draft.through} onChange={(event) => setDraft({ ...draft, through: event.target.value })} /></label>
      <button className="button button-secondary" type="submit">Apply dates</button>
    </form>
    {error && <p role="alert" className="resource-scheduler-message is-error">{error}</p>}
    {!data && !error && <p role="status">Loading booked days…</p>}
    {data && <>
      <p>{data.calendarDays} calendar days · {data.timeZone}{markedOnly ? " · Marked resources" : ""}</p>
      {data.resources.length ? <div className="resource-scheduler-matrix-wrap">
        <table className="resource-scheduler-booked-days-table">
          <thead><tr><th scope="col">Resource</th><th scope="col">Confirmed days</th><th scope="col">Pending-only days</th><th scope="col">Confirmed share</th></tr></thead>
          <tbody>{data.resources.map((resource) => <tr key={resource.id}>
            <th scope="row">{resource.name}<small>{[resource.category, resource.location].filter(Boolean).join(" · ")}</small></th>
            <td>{resource.confirmedDays}</td><td>{resource.pendingOnlyDays}</td>
            <td>{(100 * resource.confirmedDays / data.calendarDays).toFixed(1)}%</td>
          </tr>)}</tbody>
        </table>
      </div> : <p>No visible resources match the selected filters.</p>}
    </>}
  </section>;
}
