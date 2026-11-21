import { useEffect, useState } from "react";
import type { RegistrationQuestion } from "@smart-church/contracts";

type FormState = { revision: string | null; questions: RegistrationQuestion[] };
type Draft = { key: number | string; label: string; type: RegistrationQuestion["type"]; required: boolean; options: string[] };
type AnswerRow = { id: string; firstName: string; lastName: string; status: string; answers: Array<{ questionId: string; label: string; value: string }> };
type AnswerPage = { attendees: AnswerRow[]; nextOffset: number | null };

export function EventRegistrationFormSettings({ departmentId, eventId, csrfToken, readOnly }: {
  departmentId: string;
  eventId: string;
  csrfToken?: string;
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [answers, setAnswers] = useState<AnswerRow[]>();
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [answerLoading, setAnswerLoading] = useState(false);
  const path = "/api/events/" + encodeURIComponent(eventId) + "/registration-form";

  function applyForm(state: FormState) {
    setForm(state);
    setDrafts(state.questions.map(({ id, label, type, required, options }) => ({ key: id, label, type, required, options: options ?? ["", ""] })));
  }

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    fetch(path, { headers: { "x-department-id": departmentId }, signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load the registration form.");
        applyForm(await response.json() as FormState);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load the registration form.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, path, departmentId]);

  function update(key: Draft["key"], values: Partial<Draft>) {
    setDrafts((current) => current.map((draft) => draft.key === key ? { ...draft, ...values } : draft));
  }

  async function save() {
    if (!form || saving || readOnly || !csrfToken) return;
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const response = await fetch(path, {
        method: "PUT", headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken, "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: form.revision, questions: drafts.map(({ label, type, required, options }) => ({
          label: label.trim(), type, required, ...(type === "choice" ? { options: options.map((option) => option.trim()) } : {}),
        })) }),
      });
      const result = await response.json() as FormState | { error?: string };
      if (!response.ok || !("questions" in result)) throw new Error("error" in result ? result.error ?? "Could not save the form." : "Could not save the form.");
      applyForm(result);
      setNotice("Registration form saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the registration form.");
    } finally { setSaving(false); }
  }

  async function loadAnswers(offset = 0) {
    if (answerLoading) return;
    setError("");
    setAnswerLoading(true);
    try {
      const response = await fetch(path + "/answers?offset=" + offset, { headers: { "x-department-id": departmentId }, cache: "no-store" });
      if (!response.ok) throw new Error("Could not load attendee answers.");
      const result = await response.json() as AnswerPage;
      setAnswers((current) => offset ? [...(current ?? []), ...result.attendees] : result.attendees);
      setNextOffset(result.nextOffset);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load attendee answers.");
    } finally { setAnswerLoading(false); }
  }

  return <section className="event-details-section">
    <h3>Registration questions</h3>
    {!open ? <button className="button button-secondary" type="button" onClick={() => { setError(""); setOpen(true); }}>Open registration form</button> : <>
      {loading && <p role="status">Loading registration form…</p>}
      {form && !loading && <>
        <p>Each attendee answers these questions. Keep questions limited to what you need for this event.</p>
        <fieldset disabled={saving || readOnly || !csrfToken}>
          <legend>Form questions</legend>
          {drafts.map((draft, index) => <fieldset key={draft.key}>
            <legend>Question {index + 1}</legend>
            <label>Label<input value={draft.label} maxLength={120} onChange={(event) => update(draft.key, { label: event.target.value })} /></label>
            <label>Type<select value={draft.type} onChange={(event) => update(draft.key, { type: event.target.value as Draft["type"] })}>
              <option value="text">Short text</option><option value="choice">Choice</option>
            </select></label>
            <label><input type="checkbox" checked={draft.required} onChange={(event) => update(draft.key, { required: event.target.checked })} /> Required</label>
            {draft.type === "choice" && <>
              {draft.options.map((option, position) => <div key={position}><label>Option {position + 1}
                <input value={option} maxLength={80} onChange={(event) => update(draft.key, { options: draft.options.map((value, item) => item === position ? event.target.value : value) })} /></label>
                <button type="button" className="button button-secondary" onClick={() => update(draft.key, { options: draft.options.filter((_, item) => position !== item) })} disabled={draft.options.length <= 2}>Remove option</button>
              </div>)}
              <button type="button" className="button button-secondary" onClick={() => update(draft.key, { options: [...draft.options, ""] })} disabled={draft.options.length >= 8}>Add option</button>
            </>}
            <button type="button" className="button button-secondary" onClick={() => setDrafts((current) => current.filter((item) => item.key !== draft.key))}>Remove question</button>
          </fieldset>)}
          <button type="button" className="button button-secondary" disabled={drafts.length >= 8} onClick={() => {
            setDrafts((current) => [...current, { key: nextKey, label: "", required: false, type: "text", options: ["", ""] }]);
            setNextKey((key) => key + 1);
          }}>Add question</button>
          <button type="button" className="button button-primary" onClick={() => void save()}>{saving ? "Saving…" : "Save questions"}</button>
        </fieldset>
      </>}
      <button className="button button-secondary" type="button" onClick={() => void loadAnswers()} disabled={answerLoading}>{answerLoading ? "Loading answers…" : answers ? "Refresh answers" : "View attendee answers"}</button>
      {answers?.length === 0 && <p>No attendee answers have been submitted.</p>}
      {answers?.map((attendee) => <article key={attendee.id}>
        <h4>{attendee.firstName} {attendee.lastName} · {attendee.status}</h4>
        <dl>{attendee.answers.map((answer) => <div key={answer.questionId}><dt>{answer.label}</dt><dd>{answer.value}</dd></div>)}</dl>
      </article>)}
      {nextOffset !== null && <button className="button button-secondary" type="button" disabled={answerLoading} onClick={() => void loadAnswers(nextOffset)}>More answers</button>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </>}
  </section>;
}
