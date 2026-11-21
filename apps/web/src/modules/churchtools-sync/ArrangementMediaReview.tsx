import { useState, type FormEvent } from "react";

type Slot = "chart" | "audio";
type Attachment = {
  sourceId: string; label: string; bytes: number | null; type: "file" | "link"; status: string;
  media: { slot: Slot; url: string } | null;
};
type Review = { reviewHash: string; attachments: Attachment[]; target: { songTitle: string; name: string; chart: string; audio: string } };
const endpoint = "/api/modules/sync/churchtools/arrangement-media";
const statuses: Record<string, string> = {
  restricted: "Restricted in ChurchTools",
  binary_attachment: "Uploaded file",
  unsupported_url: "External address requires separate review",
  eligible: "Available for review",
  occupied: "Local link already present",
  previously_linked: "A previously linked address was removed locally",
  empty: "Available",
};

export function ArrangementMediaReview({ departmentId, csrfToken, t }: {
  departmentId: string; csrfToken: string; t: (message: string) => string;
}) {
  const [songId, setSongId] = useState("");
  const [arrangementId, setArrangementId] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [selection, setSelection] = useState<Partial<Record<Slot, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  function change(setter: (value: string) => void, value: string) {
    setter(value);
    setReview(null);
    setSelection({});
    setError("");
    setFeedback("");
  }
  async function submit(event: FormEvent<HTMLFormElement>, apply = false) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify({ songId, arrangementId, ...(apply && review ? { reviewHash: review.reviewHash, selection } : {}) }),
      });
      const body = await response.json() as Review & { error?: string; linked?: number };
      if (!response.ok) throw new Error(body.error ?? "Could not review arrangement media.");
      if (apply) {
        setFeedback(body.linked ? "Reviewed links added to the local arrangement." : "These arrangement links were already applied.");
        setReview(null);
      } else setReview(body);
      setSelection({});
    } catch (failure) {
      setReview(null);
      setSelection({});
      setError(failure instanceof Error ? failure.message : "Could not review arrangement media.");
    } finally { setBusy(false); }
  }
  return <section className="directory-card sync-controls-card">
    <div><h2>{t("ChurchTools arrangement media")}</h2>
      <p>{t("Review attachments for an imported arrangement. Approved external links can fill empty chart and audio slots in Worship Planning.")}</p></div>
    <form onSubmit={(event) => void submit(event)}>
      <fieldset disabled={busy}>
        <div className="form-row">
          <label>{t("Source song ID")}<input required pattern="[1-9][0-9]{0,15}" inputMode="numeric" value={songId}
            onChange={(event) => change(setSongId, event.target.value)} /></label>
          <label>{t("Source arrangement ID")}<input required pattern="[1-9][0-9]{0,15}" inputMode="numeric" value={arrangementId}
            onChange={(event) => change(setArrangementId, event.target.value)} /></label>
        </div>
        <button type="submit" className="button button-secondary">{t("Review attachments")}</button>
      </fieldset>
    </form>
    {review && <form onSubmit={(event) => void submit(event, true)}>
      <p><strong>{review.target.songTitle}</strong> · {review.target.name}</p>
      {review.attachments.length ? <div className="table-wrap"><table>
        <thead><tr><th scope="col">{t("Source attachment")}</th><th scope="col">{t("Status")}</th></tr></thead>
        <tbody>{review.attachments.map((entry) => <tr key={entry.sourceId}>
          <td>#{entry.sourceId}{entry.label && ` · ${entry.label}`}{entry.bytes != null && ` · ${entry.bytes.toLocaleString()} B`}</td>
          <td>{t(statuses[entry.status] ?? entry.status)}</td>
        </tr>)}</tbody>
      </table></div> : <p>{t("ChurchTools returned zero visible attachments.")}</p>}
      <fieldset disabled={busy}>
        {(["chart", "audio"] as const).map((slot) => {
          const label = slot === "chart" ? "Chart link" : "Audio link";
          const eligible = review.attachments.filter((entry) => entry.media?.slot === slot);
          return <label key={slot}>{t(label)}
            {review.target[slot] !== "empty" || !eligible.length
              ? <span> · {t(review.target[slot] === "empty" ? "No eligible attachment" : statuses[review.target[slot]])}</span>
              : <select value={selection[slot] ?? ""} onChange={(event) => setSelection((current) => ({
                ...current, [slot]: event.target.value || undefined,
              }))}>
                <option value="">{t("Leave empty")}</option>
                {eligible.map((entry) => <option key={entry.sourceId} value={entry.sourceId}>
                  {entry.label || `#${entry.sourceId}`} · {entry.media!.url}
                </option>)}
              </select>}
          </label>;
        })}
        {(selection.chart || selection.audio) && <>
          <p>{t("Applying a link makes it visible to people who can view this arrangement in Smart-Church.")}</p>
          <button className="button button-primary" type="submit">{t("Apply reviewed links")}</button>
        </>}
      </fieldset>
    </form>}
    {busy && <p role="status">{t("Reading ChurchTools arrangement media…")}</p>}
    {feedback && <p role="status">{t(feedback)}</p>}
    {error && <p role="alert">{t(error)}</p>}
  </section>;
}
