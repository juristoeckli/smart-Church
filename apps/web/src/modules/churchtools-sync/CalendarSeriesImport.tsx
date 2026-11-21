import { useEffect, useState, type FormEvent } from "react";

type Target = { id: string; name: string };
type Preview = {
  action: "create" | "link_existing" | "already_imported" | "already_linked" | "source_changed";
  reviewHash: string;
  eventLinks: Array<{ originalStart: string; status: string }>;
  review: { title: string; subtitle: string; zone: string; pattern: string; allDay: boolean;
    dates: Array<{ date: string; startsAt: string; endsAt: string; eventId: string | null }> };
};
const endpoint = "/api/modules/sync/churchtools/calendar-series";
const actionMessages: Record<Preview["action"], string> = {
  create: "Ready to import to your personal calendar.",
  link_existing: "Verified links are ready to add to the existing personal calendar series.",
  already_imported: "An identical source snapshot was already imported.",
  already_linked: "The source series already has a local import link.",
  source_changed: "The source series changed. Review the previously imported copy in Calendar.",
};

const linkMessages: Record<string, string> = {
  ready: "Ready to link",
  already_linked: "Already linked",
  service_event_unverified: "No verified local import for this source event",
  service_event_unavailable: "Local service event unavailable",
  service_event_date_differs: "Local service event date differs",
  calendar_occurrence_changed: "Local occurrence has changed",
  calendar_link_conflict: "Local occurrence has an existing link choice",
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
  const [linkServiceEvents, setLinkServiceEvents] = useState(false);
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
        body: JSON.stringify({ calendarId, seriesId, timeZone: timeZone.trim(), targetCalendarId, linkServiceEvents,
          ...(apply && preview ? { reviewHash: preview.reviewHash } : {}) }),
      });
      const body = await response.json() as Preview & { error?: string; linkedEvents?: number };
      if (!response.ok) throw new Error(body.error ?? "Could not import the ChurchTools series.");
      if (apply) {
        const imported = response.status === 201;
        setFeedback(imported ? "Series imported to your personal calendar."
          : body.linkedEvents ? "Reviewed service events linked to your personal calendar." : actionMessages.already_imported);
        setPreview(null);
      } else setPreview(body);
    } catch (failure) {
      setPreview(null);
      setError(failure instanceof Error ? failure.message : "Could not import the ChurchTools series.");
    } finally { setBusy(false); }
  }
  return <section className="directory-card sync-controls-card">
    <div><h2>{t("ChurchTools calendar series")}</h2>
      <p>{t("Copy the calculated dates of a recurring series to your personal calendar. The copy keeps its dates and can be edited in Calendar.")}</p></div>
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
          <label><input type="checkbox" checked={linkServiceEvents} onChange={(event) => {
            setLinkServiceEvents(event.target.checked); setPreview(null); setFeedback(""); setError("");
          }} /> {t("Include verified links to imported service events")}</label>
          {linkServiceEvents && <p>{t("The review uses service events imported through a current ChurchTools migration preview.")}</p>}
          <button type="submit" className="button button-secondary">{t("Review calculated dates")}</button>
        </fieldset>
      </form>
      {preview && <form onSubmit={(event) => void submit(event, true)}>
        <p><strong>{preview.review.title}</strong> · {t(preview.review.pattern)} · {preview.review.allDay ? t("All day") : preview.review.zone}</p>
        <p>{t(actionMessages[preview.action])}</p>
        <details><summary>{preview.review.dates.length} {t("calculated dates")}</summary>
          <div className="table-wrap"><table>
            <thead><tr><th scope="col">{t(preview.review.allDay ? "First day" : "Starts at")}</th><th scope="col">{t(preview.review.allDay ? "Last day (inclusive)" : "Ends at")}</th><th scope="col">{t("ChurchTools service event ID")}</th>{linkServiceEvents && <th scope="col">{t("Service link")}</th>}</tr></thead>
            <tbody>{preview.review.dates.map((date) => <tr key={date.date}>
              <td>{preview.review.allDay ? date.startsAt.slice(0, 10) : date.startsAt.replace("T", " ")}</td>
              <td>{preview.review.allDay ? date.endsAt.slice(0, 10) : date.endsAt.replace("T", " ")}</td>
              <td>{date.eventId ?? "—"}</td>
              {linkServiceEvents && <td>{t(linkMessages[preview.eventLinks.find(({ originalStart }) => originalStart === date.startsAt)?.status ?? ""] ?? "—")}</td>}</tr>)}</tbody>
          </table></div>
        </details>
        {(preview.action === "create" || preview.action === "link_existing") && <button type="submit" className="button button-primary" disabled={busy}>
          {t(preview.action === "create" ? "Import reviewed dates" : "Apply reviewed service links")}</button>}
      </form>}
    </>}
    {busy && <p role="status">{t("Reading ChurchTools appointment series…")}</p>}
    {feedback && <p role="status">{t(feedback)}</p>}
    {error && <p role="alert">{t(error)}</p>}
  </section>;
}
