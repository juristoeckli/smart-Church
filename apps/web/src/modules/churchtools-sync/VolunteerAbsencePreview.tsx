import { useState, type FormEvent } from "react";

type Preview = { dates: Array<{ sourceId: string; sourceStartDate: string; sourceEndDate: string; timed: boolean }>; unsupported: number };
export function VolunteerAbsencePreview({ departmentId, t }: { departmentId: string; t: (message: string) => string }) {
  const [scope, setScope] = useState({ personId: "", from: "", through: "" });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function change(field: keyof typeof scope, value: string) {
    setScope({ ...scope, [field]: value });
    setPreview(null);
    setError("");
  }
  async function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setPreview(null);
    setError("");
    try {
      const query = new URLSearchParams(scope);
      const response = await fetch(`/api/modules/sync/churchtools/absence-preview?${query}`, { headers: { "x-department-id": departmentId } });
      const result = await response.json() as Preview & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not review ChurchTools absences.");
      setPreview(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not review ChurchTools absences."); }
    finally { setBusy(false); }
  }
  return <section className="directory-card sync-controls-card">
    <div><h2>{t("ChurchTools absence preview")}</h2>
      <p>{t("Review source absence dates for one verified People record before entering availability in Events.")}</p></div>
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
    {error && <p role="alert">{t(error)}</p>}
    {preview && <>
      {preview.dates.length ? <div className="table-wrap"><table>
        <thead><tr><th scope="col">{t("Source absence")}</th><th scope="col">{t("Source start date")}</th>
          <th scope="col">{t("Source end date")}</th><th scope="col">{t("Source type")}</th></tr></thead>
        <tbody>{preview.dates.map((row) => <tr key={row.sourceId}>
          <td>#{row.sourceId}</td><td>{row.sourceStartDate}</td><td>{row.sourceEndDate}</td><td>{t(row.timed ? "Timed" : "All-day")}</td>
        </tr>)}</tbody>
      </table></div> : <p>{t("No visible absences in the selected dates.")}</p>}
      {!!preview.unsupported && <p>{preview.unsupported} {t("source records had unsupported dates.")}</p>}
    </>}
  </section>;
}
