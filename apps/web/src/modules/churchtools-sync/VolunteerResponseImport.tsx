import { useState, type FormEvent } from "react";

type Review = {
  event: { title: string; date: string }; reviewHash: string;
  counts: { hiddenOrUnassigned: number; inactive: number; pending: number; unsupported: number };
  rows: Array<{ sourceId: string; positionIndex: number | null; name: string; status: string }>;
};
const labels: Record<string, string> = {
  ready: "Ready to import", already_imported: "Already imported", person_not_verified: "Person needs a fresh verified migration",
  local_event_time_changed: "The local event date or time differs",
  source_slot_ambiguous: "Multiple matching source assignments", local_slot_ambiguous: "Multiple matching local role slots",
  local_slot_changed: "The local assignment differs", local_response_present: "Local response already recorded",
  hiddenOrUnassigned: "Hidden or unassigned", inactive: "Inactive source records", pending: "Pending source responses", unsupported: "Unrecognized source responses",
};

export function VolunteerResponseImport({ departmentId, csrfToken, t }: {
  departmentId: string; csrfToken: string; t: (message: string) => string;
}) {
  const [eventId, setEventId] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>, apply = false) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      const response = await fetch("/api/modules/sync/churchtools/volunteer-responses", {
        method: "POST", headers: { "Content-Type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify({ eventId, ...(apply && review ? { reviewHash: review.reviewHash, sourceIds: selected } : {}) }),
      });
      const data = await response.json() as Review & { imported?: number; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not review ChurchTools volunteer responses.");
      if (apply) {
        setFeedback(data.imported ? "Reviewed acceptances imported into Events." : "The selected acceptances were already imported.");
        setReview(null);
      } else setReview(data);
      setSelected([]);
    } catch (failure) {
      setReview(null);
      setSelected([]);
      setError(failure instanceof Error ? failure.message : "Could not review ChurchTools volunteer responses.");
    } finally { setBusy(false); }
  }
  return <section className="directory-card sync-controls-card">
    <div><h2>{t("ChurchTools volunteer responses")}</h2>
      <p>{t("Review active acceptances for an imported event and its verified People records. The original reply time is left blank.")}</p></div>
    <form onSubmit={(event) => void submit(event)}>
      <fieldset disabled={busy}>
        <label>{t("Source event ID")}<input value={eventId} inputMode="numeric" required pattern="[1-9][0-9]{0,15}"
          onChange={(event) => { setEventId(event.target.value); setReview(null); setSelected([]); setError(""); setFeedback(""); }} /></label>
        <button type="submit" className="button button-secondary">{t("Review volunteer responses")}</button>
      </fieldset>
    </form>
    {review && <form onSubmit={(event) => void submit(event, true)}>
      <p><strong>{review.event.title}</strong> · {review.event.date}</p>
      <p>{t("Selected acceptances will appear on the local event.")}</p>
      <div className="community-inline-actions">{Object.entries(review.counts).map(([key, count]) =>
        <span key={key}>{t(labels[key])} {count}</span>)}</div>
      {review.rows.length ? <fieldset disabled={busy}>
        <div className="table-wrap"><table>
          <thead><tr><th scope="col">{t("Source assignment")}</th><th scope="col">{t("Role and slot")}</th><th scope="col">{t("Status")}</th></tr></thead>
          <tbody>{review.rows.map((row) => <tr key={row.sourceId}>
            <td>{row.status === "ready" ? <label><input type="checkbox" checked={selected.includes(row.sourceId)}
              disabled={!selected.includes(row.sourceId) && selected.length >= 40}
              onChange={(event) => setSelected((current) => event.target.checked ? [...current, row.sourceId] : current.filter((id) => id !== row.sourceId))} /> #{row.sourceId}</label> : `#${row.sourceId}`}</td>
            <td>{row.name}{row.positionIndex == null ? "" : ` · ${row.positionIndex + 1}`}</td><td>{t(labels[row.status] ?? row.status)}</td>
          </tr>)}</tbody>
        </table></div>
        {!!selected.length && <button type="submit" className="button button-primary">{t("Import selected acceptances")} ({selected.length})</button>}
      </fieldset> : <p>{t("There are zero visible active acceptances for this event.")}</p>}
    </form>}
    {busy && <p role="status">{t("Reading ChurchTools volunteer responses…")}</p>}
    {feedback && <p role="status">{t(feedback)}</p>}
    {error && <p role="alert">{t(error)}</p>}
  </section>;
}
