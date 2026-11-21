import { useState, type FormEvent } from "react";

type Preview = { dates: Array<{ sourceId: string; sourceStartDate: string; sourceEndDate: string; timed: boolean; status: string; localStart?: string; localEnd?: string; localZone?: string; startUtc?: string; endUtc?: string }>; unsupported: number; reviewHash: string; consentGranted: boolean };
const statusLabels: Record<string, string> = {
  ready: "Ready to import", timed_consent_required: "Separate volunteer permission required for timed absences",
  timed_consent_timezone_changed: "Volunteer permission needs to be renewed for this location time zone",
  unverified_source_time: "Source time or time zone could not be verified", consent_required: "Volunteer permission required",
  outside_consent: "Outside the volunteer’s allowed dates", outside_review: "Outside the review dates",
  unsupported_range: "Unsupported date range", local_copy_present: "These dates are already recorded locally",
  local_overlap: "Overlaps local availability", already_imported: "Already imported",
  source_changed: "Source dates changed", local_changed: "Local dates were edited", local_removed: "Local dates were removed",
};
export function VolunteerAbsencePreview({ departmentId, csrfToken, t }: { departmentId: string; csrfToken: string; t: (message: string) => string }) {
  const [scope, setScope] = useState({ personId: "", from: "", through: "" });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function change(field: keyof typeof scope, value: string) {
    setScope({ ...scope, [field]: value });
    setPreview(null);
    setError("");
    setFeedback("");
    setSelection([]);
  }
  async function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setPreview(null);
    setError("");
    setSelection([]);
    setFeedback("");
    try {
      const query = new URLSearchParams(scope);
      const response = await fetch(`/api/modules/sync/churchtools/absence-preview?${query}`, { headers: { "x-department-id": departmentId } });
      const result = await response.json() as Preview & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not review ChurchTools absences.");
      setPreview(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not review ChurchTools absences."); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!preview || !selection.length || busy) return;
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      const response = await fetch("/api/modules/sync/churchtools/absence-import", {
        method: "POST", headers: { "Content-Type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify({ ...scope, reviewHash: preview.reviewHash, sourceIds: selection }),
      });
      const result = await response.json() as { imported?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not import the selected absences.");
      setFeedback(result.imported ? "Selected dates imported into Events availability." : "The selected dates were already imported.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not import the selected absences."); }
    finally { setBusy(false); setPreview(null); setSelection([]); }
  }
  return <section className="directory-card sync-controls-card">
    <div><h2>{t("ChurchTools absence preview")}</h2>
      <p>{t("Review source absence dates for a verified People record. Volunteers can allow all-day and timed imports in My volunteer availability.")}</p></div>
    <form onSubmit={(event) => void load(event)}>
      <fieldset disabled={busy}>
        <div className="form-row">
          <label>{t("Source person ID")}<input required inputMode="numeric" pattern="[1-9][0-9]{0,15}" value={scope.personId}
            onChange={(event) => change("personId", event.target.value)} /></label>
          <label>{t("From")}<input type="date" required value={scope.from} max={scope.through || undefined}
            onChange={(event) => change("from", event.target.value)} /></label>
          <label>{t("Through")}<input type="date" required value={scope.through} min={scope.from || undefined}
            onChange={(event) => change("through", event.target.value)} /></label>
        </div>
        <button type="submit" className="button button-secondary">{t("Review dates")}</button>
      </fieldset>
    </form>
    {busy && <p role="status">{t("Reading ChurchTools absences…")}</p>}
    {feedback && <p role="status">{t(feedback)}</p>}
    {error && <p role="alert">{t(error)}</p>}
    {preview && <>
      {!preview.consentGranted && <p>{t("The volunteer needs to allow date import before any dates can be selected.")}</p>}
      {preview.dates.length ? <div className="table-wrap"><table>
        <thead><tr><th scope="col">{t("Source absence")}</th><th scope="col">{t("Source start date")}</th>
          <th scope="col">{t("Source end date")}</th><th scope="col">{t("Reviewed interval")}</th><th scope="col">{t("Status")}</th></tr></thead>
        <tbody>{preview.dates.map((row) => <tr key={row.sourceId}>
          <td>{row.status === "ready" ? <label>
            <input type="checkbox" checked={selection.includes(row.sourceId)} disabled={busy || (!selection.includes(row.sourceId) && selection.length >= 25)}
              onChange={(event) => setSelection((current) => event.target.checked ? [...current, row.sourceId] : current.filter((id) => id !== row.sourceId))} /> #{row.sourceId}
          </label> : `#${row.sourceId}`}</td><td>{row.sourceStartDate}</td><td>{row.sourceEndDate}</td>
          <td>{row.localStart && row.localEnd ? <>
            {row.localStart.replace("T", " ")} – {row.localEnd.replace("T", " ")} · {row.localZone}
            <small>{row.startUtc} – {row.endUtc}</small>
          </> : row.timed ? t("Timed") : t("All day")}</td>
          <td>{t(statusLabels[row.status] ?? row.status)}</td>
        </tr>)}</tbody>
      </table></div> : <p>{t("No visible absences in the selected dates.")}</p>}
      {!!selection.length && <button type="button" className="button button-primary" disabled={busy} onClick={() => void apply()}>
        {t("Import selected absences")} ({selection.length})
      </button>}
      {!!preview.unsupported && <p>{preview.unsupported} {t("source records had unsupported dates.")}</p>}
    </>}
  </section>;
}
