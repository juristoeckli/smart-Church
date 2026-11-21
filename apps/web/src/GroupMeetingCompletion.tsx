import { useEffect, useRef, useState, type FormEvent } from "react";
import { getGroupCompletionFeedback, type CompletionFeedbackDraft } from "./group-attendance";
import "./GroupMeetingCompletion.css";

type Form = Awaited<ReturnType<typeof getGroupCompletionFeedback>>;
type Props = {
  meetingId: string;
  departmentId: string;
  completedAt: string | null;
  disabled: boolean;
  buttonClass: string;
  onComplete: (feedback?: CompletionFeedbackDraft) => Promise<boolean>;
};

export function GroupMeetingCompletion({ meetingId, departmentId, completedAt, disabled, buttonClass, onComplete }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Form>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setDraft(undefined);
    setError("");
    void getGroupCompletionFeedback(meetingId, departmentId, controller.signal).then((result) => {
      if (!controller.signal.aborted) setDraft(result);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load leader feedback.");
    });
    return () => controller.abort();
  }, [open, meetingId, departmentId, retry]);

  async function complete(feedback?: CompletionFeedbackDraft) {
    if (await onComplete(feedback)) setOpen(false);
    else if (feedback) setError("Review the meeting status. Reload the feedback form before trying again.");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft) void complete({
      comment: draft.comment,
      guestCount: draft.guestCount,
      answers: draft.answers,
      expectedUpdatedAt: draft.expectedUpdatedAt,
    });
  }

  return <>
    <button type="button" className={buttonClass} disabled={disabled} onClick={() => {
      if (completedAt) void complete();
      else setOpen(true);
    }}>{completedAt ? "Reopen attendance" : "Complete attendance"}</button>
    {open && <dialog ref={dialog} className="group-completion-dialog" aria-label="Complete group meeting" onCancel={(event) => { event.preventDefault(); if (!disabled) setOpen(false); }}>
      <h2>Complete group meeting</h2>
      <p>Completing locks this attendance roster until it is reopened.</p>
      {!draft && !error && draft === undefined && <p role="status">Loading optional leader feedback…</p>}
      {error && <div role="alert">{error} <button className={buttonClass} type="button" disabled={disabled} onClick={() => setRetry((value) => value + 1)}>Reload feedback</button></div>}
      {draft && <form id="group-completion-feedback" onSubmit={submit}>
        <label>Guest count<input type="number" min={0} max={100000} step={1} disabled={disabled} value={draft.guestCount ?? ""} onChange={(event) => {
          setDraft({ ...draft, guestCount: event.target.value === "" ? null : Number(event.target.value) });
        }} /></label>
        <label>Meeting comment<textarea maxLength={2000} rows={3} disabled={disabled} value={draft.comment} onChange={(event) => setDraft({ ...draft, comment: event.target.value })} /></label>
        {draft.title && <h3>{draft.title}</h3>}
        {draft.questions.map((question) => <label key={question.id}>{question.prompt}
          <textarea rows={2} maxLength={2000} disabled={disabled} value={draft.answers[question.id] ?? ""} onChange={(event) => {
            setDraft({ ...draft, answers: { ...draft.answers, [question.id]: event.target.value } });
          }} />
        </label>)}
      </form>}
      <footer>
        <button className={buttonClass} type="button" disabled={disabled} onClick={() => setOpen(false)}>Cancel</button>
        <button className={buttonClass} type="button" disabled={disabled} onClick={() => void complete()}>{draft ? "Complete without changing feedback" : "Complete without feedback"}</button>
        {draft && <button className="button button-primary" type="submit" form="group-completion-feedback" disabled={disabled || Boolean(error)}>Save feedback and complete</button>}
      </footer>
    </dialog>}
  </>;
}
