import { useEffect, useState } from "react";
import type { CalendarAppointmentTarget } from "./module-registry";

type SignupAppointmentLink = CalendarAppointmentTarget & { title: string; calendarName: string };
type Appointment = {
  appointmentId: string; title: string; calendarName: string; calendarScope: string; occurrenceStartAt: string;
  originalOccurrenceStartAt: string; canManage: boolean; internalOnly: boolean; signupGroupId?: string | null; allDay: boolean;
};
type Occurrence = { appointmentId: string; originalStartAt: string };
const occurrenceKey = ({ appointmentId, originalStartAt }: CalendarAppointmentTarget) => appointmentId + ":" + originalStartAt;
const describe = ({ title, calendarName, date }: SignupAppointmentLink) => [title, calendarName, date].join(" · ");
function today() {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, "0")).join("-");
}

export function GroupSignupAppointments({ departmentId, groupId, onOpen, assignmentCsrfToken }: {
  departmentId: string; groupId: string; onOpen: (target: CalendarAppointmentTarget) => void; assignmentCsrfToken?: string;
}) {
  const [links, setLinks] = useState<SignupAppointmentLink[] | null>(null);
  const [linkError, setLinkError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(today);
  const [previousKey, setPreviousKey] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [choices, setChoices] = useState<SignupAppointmentLink[] | null>(null);
  const [choiceError, setChoiceError] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [feedback, setFeedback] = useState("");
  const endpoint = "/api/modules/church-calendar/signup-groups/" + groupId;
  useEffect(() => {
    const controller = new AbortController();
    setLinkError("");
    void fetch(endpoint + "/appointments", {
      headers: { "x-department-id": departmentId }, cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error();
      const data = await response.json() as SignupAppointmentLink[];
      if (!controller.signal.aborted) setLinks(data);
    }).catch(() => {
      if (!controller.signal.aborted) setLinkError("Could not load linked Calendar appointments.");
    });
    return () => controller.abort();
  }, [departmentId, endpoint, refresh]);
  useEffect(() => {
    if (!editing || !date) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ from: date + "T00:00", to: date + "T23:59:59" });
    void fetch("/api/modules/church-calendar/appointments?" + query, {
      headers: { "x-department-id": departmentId }, cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error();
      const data = await response.json() as Appointment[];
      if (controller.signal.aborted) return;
      setChoices(data.filter((item) => item.calendarScope === "community" && item.canManage && !item.internalOnly && !item.signupGroupId)
        .map((item) => ({ appointmentId: item.appointmentId, originalStartAt: item.originalOccurrenceStartAt, title: item.title,
          calendarName: item.calendarName, date: item.allDay ? item.occurrenceStartAt.slice(0, 10) : item.occurrenceStartAt.slice(0, 16).replace("T", " ") })));
    }).catch(() => {
      if (!controller.signal.aborted) setChoiceError("Could not load Calendar occurrences for this date.");
    });
    return () => controller.abort();
  }, [date, departmentId, editing, refresh]);

  function startEditing() {
    setPreviousKey(links?.length === 1 ? occurrenceKey(links[0]) : "");
    setTargetKey("");
    setChoices(null);
    setChoiceError("");
    setSaveError("");
    setFeedback("");
    setReviewing(false);
    setEditing(true);
  }

  const previous = links?.find((link) => occurrenceKey(link) === previousKey);
  const target = choices?.find((link) => occurrenceKey(link) === targetKey);
  async function save() {
    if (!target?.originalStartAt || (links?.length && !previous?.originalStartAt) || !assignmentCsrfToken || saving) return;
    const occurrence = (link: SignupAppointmentLink): Occurrence => ({ appointmentId: link.appointmentId, originalStartAt: link.originalStartAt! });
    setSaving(true);
    setSaveError("");
    try {
      const response = await fetch(endpoint + "/appointment", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-department-id": departmentId, "x-csrf-token": assignmentCsrfToken },
        body: JSON.stringify({ appointment: occurrence(target), ...(previous ? { previous: occurrence(previous) } : {}) }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || "Could not save the Calendar appointment link.");
      }
      setLinks(null);
      setEditing(false);
      setReviewing(false);
      setFeedback(previous ? "Registration group moved." : "Registration group assigned.");
      setRefresh((value) => value + 1);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save the Calendar appointment link.");
      setReviewing(false);
      setTargetKey("");
      setChoices(null);
      setRefresh((value) => value + 1);
    } finally {
      setSaving(false);
    }
  }

  if (!assignmentCsrfToken && !links?.length) return null;
  return <section className="event-details-section">
    <h3>Linked Calendar appointments</h3>
    {linkError && <p role="alert">{linkError} <button className="button button-secondary" type="button" onClick={() => setRefresh((value) => value + 1)}>Retry</button></p>}
    {links && links.length > 0 && <ul>{links.map((link) => <li key={occurrenceKey(link)}>
      <span>{describe(link)}</span>
      <button type="button" className="button button-secondary" onClick={() => onOpen(link)}>Open appointment</button>
    </li>)}</ul>}
    {feedback && <p role="status">{feedback}</p>}
    {assignmentCsrfToken && links && !linkError && !editing && <button type="button" className="button button-secondary" onClick={startEditing}>
      {links.length > 0 ? "Move registration group" : "Assign to Calendar appointment"}
    </button>}
    {assignmentCsrfToken && editing && <div>
      {saveError && <p role="alert">{saveError}</p>}
      {reviewing && target ? <>
        <p>{previous ? <>Move the group from <strong>{describe(previous)}</strong> to <strong>{describe(target)}</strong>.</>
          : <>Assign the group to <strong>{describe(target)}</strong>.</>}</p>
        <p>This changes the Calendar link. The signup form and its publication settings are kept.</p>
        <div className="form-actions">
          <button type="button" className="button button-secondary" disabled={saving} onClick={() => setReviewing(false)}>Back</button>
          <button type="button" className="button button-primary" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : previous ? "Confirm move" : "Confirm assignment"}
          </button>
        </div>
      </> : <>
        {!!links?.length && <label>Current occurrence
          <select value={previousKey} onChange={(event) => setPreviousKey(event.target.value)}>
            <option value="">Choose current occurrence</option>
            {links.map((link) => <option key={occurrenceKey(link)} value={occurrenceKey(link)}>{describe(link)}</option>)}
          </select>
        </label>}
        <label>Occurrence date
          <input type="date" value={date} onChange={(event) => { setDate(event.target.value); setTargetKey(""); setChoices(null); setChoiceError(""); }} />
        </label>
        {date && choices === null && !choiceError && <p role="status">Loading occurrences…</p>}
        {choiceError && <p role="alert">{choiceError} <button type="button" className="button button-secondary" onClick={() => {
          setChoiceError(""); setRefresh((value) => value + 1);
        }}>Retry</button></p>}
        {choices && (choices.length > 0 ? <label>Destination occurrence
          <select value={targetKey} onChange={(event) => setTargetKey(event.target.value)}>
            <option value="">Choose destination</option>
            {choices.map((link) => <option key={occurrenceKey(link)} value={occurrenceKey(link)}>{describe(link)}</option>)}
          </select>
        </label> : <p>No available Community Calendar occurrences on this date.</p>)}
        <div className="form-actions">
          <button type="button" className="button button-secondary" onClick={() => setEditing(false)}>Cancel</button>
          <button type="button" className="button button-primary" disabled={Boolean(linkError) || !target || Boolean(links?.length && !previous)} onClick={() => setReviewing(true)}>Review assignment</button>
        </div>
      </>}
    </div>}
  </section>;
}
