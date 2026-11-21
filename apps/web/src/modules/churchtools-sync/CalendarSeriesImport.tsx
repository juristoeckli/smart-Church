import { useEffect, useState, type FormEvent } from "react";

type Target = { id: string; name: string };
type Preview = {
  action: "create" | "already_imported" | "already_linked" | "source_changed";
  reviewHash: string;
  review: { title: string; subtitle: string; zone: string; pattern: string;
    dates: Array<{ date: string; startsAt: string; endsAt: string; startsAtUtc: string; eventId: string | null }> };
};
const endpoint = "/api/modules/sync/churchtools/calendar-series";
const actionMessages: Record<Preview["action"], string> = {
  create: "Ready to import to your personal calendar.",
  already_imported: "An identical source snapshot was already imported.",
  already_linked: "The source series already has a local import link.",
  source_changed: "The source series changed. Review the previously imported copy in Calendar.",
};

export function CalendarSeriesImport({ departmentId, csrfToken, t }: {
  departmentId: string; csrfToken: string; t: (message: string) => string;
}) {
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [targetCalendarId, setTargetCalendarId] = useState("");
  const [calendarId, setCalendarId] = useState("");
  const [seriesId, setSeriesId] = useState("");
  const [timeZone, setTimeZone] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${endpoint}/targets`, { signal: controller.signal, headers: { "x-department-id": departmentId } })
      .then(async (response) => {
        const body = await response.json() as { calendars: Target[]; available: boolean; error?: string };
        if (!response.ok) throw new Error(body.error ?? "Could not load personal calendars.");
        setAvailable(body.available);
        setTargets(body.calendars);
        setTargetCalendarId(body.calendars[0]?.id ?? "");
      }).catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Could not load personal calendars.");
      });
    return () => controller.abort();
  }, [departmentId]);
  const change = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPreview(null);
    setFeedback("");
    setError("");
  };
  async function submit(event: FormEvent<HTMLFormElement>, apply = false) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json", "x-department-id": departmentId, "x-csrf-token": csrfToken },
        body: JSON.stringify({ calendarId, seriesId, timeZone: timeZone.trim(), targetCalendarId,
          ...(apply && preview ? { reviewHash: preview.reviewHash } : {}) }),
      });
      const body = await response.json() as Preview & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not import the ChurchTools series.");
      if (apply) {
        const imported = response.status === 201;
        setFeedback(imported ? "Series imported to your personal calendar." : actionMessages.already_imported);
        setPreview(null);
      } else setPreview(body);
    } catch (failure) {
      setPreview(null);
      setError(failure instanceof Error ? failure.message : "Could not import the ChurchTools series.");
    } finally { setBusy(false); }
  }
  return <section className="directory-card sync-controls-card">
    <div><h2>{t("ChurchTools calendar series")}</h2>
      <p>{t("Copy the calculated dates of a timed series to your personal calendar. The copy keeps its dates and can be edited in Calendar.")}</p></div>
    {!available && <p>{t("Enable the Calendar module to import a series.")}</p>}
    {available && targets?.length === 0 && <p>{t("Create a personal calendar in Calendar first.")}</p>}
    {!!targets?.length && <>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy}>
          <div className="form-row">
            <label>{t("Source calendar ID")}<input required inputMode="numeric" pattern="[1-9][0-9]{0,15}" value={calendarId} onChange={(event) => change(setCalendarId)(event.target.value)} /></label>
            <label>{t("Source appointment ID")}<input required inputMode="numeric" pattern="[1-9][0-9]{0,15}" value={seriesId} onChange={(event) => change(setSeriesId)(event.target.value)} /></label>
          </div>
          <div className="form-row">
            <label>{t("Source site time zone")}<input required maxLength={80} placeholder="Europe/Zurich" value={timeZone} onChange={(event) => change(setTimeZone)(event.target.value)} /></label>
            <label>{t("Personal calendar")}<select required value={targetCalendarId} onChange={(event) => change(setTargetCalendarId)(event.target.value)}>
              {targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
            </select></label>
          </div>
          <button type="submit" className="button button-secondary">{t("Review calculated dates")}</button>
        </fieldset>
      </form>
      {preview && <form onSubmit={(event) => void submit(event, true)}>
        <p><strong>{preview.review.title}</strong> · {t(preview.review.pattern)} · {preview.review.zone}</p>
        <p>{t(actionMessages[preview.action])}</p>
        <details><summary>{preview.review.dates.length} {t("calculated dates")}</summary>
          <div className="table-wrap"><table>
            <thead><tr><th scope="col">{t("Starts at")}</th><th scope="col">{t("Ends at")}</th><th scope="col">{t("ChurchTools service event ID")}</th></tr></thead>
            <tbody>{preview.review.dates.map((date) => <tr key={date.date}><td>{date.startsAt.replace("T", " ")}</td><td>{date.endsAt.replace("T", " ")}</td><td>{date.eventId ?? "—"}</td></tr>)}</tbody>
          </table></div>
        </details>
        {preview.action === "create" && <button type="submit" className="button button-primary" disabled={busy}>{t("Import reviewed dates")}</button>}
      </form>}
    </>}
    {busy && <p role="status">{t("Reading ChurchTools appointment series…")}</p>}
    {feedback && <p role="status">{t(feedback)}</p>}
    {error && <p role="alert">{t(error)}</p>}
  </section>;
}
