import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { fullDayBookingWindow, localInputInZone, zonedInputToUtc } from "./zoned-input";

type Schedule = {
  startsAt: string; endsAt: string; quantity: number; maxQuantity: number; timeZone: string;
  allDayDate: string | null; status: "requested" | "approved"; requiresApproval: boolean;
};
type BookingDetails = { purpose: string; subtitle: string; description: string; revision: string; schedule?: Schedule | null };
type ScheduleDraft = Pick<Schedule, "startsAt" | "endsAt" | "quantity" | "allDayDate">;

function scheduleDraft(schedule: Schedule): ScheduleDraft {
  return { allDayDate: schedule.allDayDate, quantity: schedule.quantity,
    startsAt: localInputInZone(new Date(schedule.startsAt), schedule.timeZone),
    endsAt: localInputInZone(new Date(schedule.endsAt), schedule.timeZone) };
}

function schedulePayload(draft: ScheduleDraft, original: Schedule) {
  const unchanged = scheduleDraft(original);
  if (draft.allDayDate !== null) {
    const window = draft.allDayDate === original.allDayDate ? { startsAt: original.startsAt, endsAt: original.endsAt }
      : fullDayBookingWindow(draft.allDayDate, original.timeZone);
    return { ...window, quantity: draft.quantity, allDayDate: draft.allDayDate };
  }
  return {
    startsAt: draft.startsAt === unchanged.startsAt ? original.startsAt : zonedInputToUtc(draft.startsAt, original.timeZone),
    endsAt: draft.endsAt === unchanged.endsAt ? original.endsAt : zonedInputToUtc(draft.endsAt, original.timeZone),
    quantity: draft.quantity,
  };
}

export function BookingDetailsDialog({ departmentId, bookingId, csrfToken, onClose, onSaved }: {
  departmentId: string; bookingId: string; csrfToken: string; onClose: () => void; onSaved: (changed: boolean, needsApproval: boolean) => void;
}) {
  const [draft, setDraft] = useState<BookingDetails | null>(null);
  const [schedule, setSchedule] = useState<ScheduleDraft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestController = useRef<AbortController | null>(null);
  const endpoint = `/api/modules/resource-scheduler/bookings/${encodeURIComponent(bookingId)}/details`;
  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint, { headers: { "x-department-id": departmentId }, cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as BookingDetails & { error?: string };
        if (!response.ok) throw new Error(result.error ?? "Could not load booking details.");
        if (!controller.signal.aborted) setDraft(result);
      })
      .catch((reason: Error) => { if (!controller.signal.aborted) setError(reason.message); });
    return () => { controller.abort(); requestController.current?.abort(); };
  }, [departmentId, endpoint]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || busy || !draft.purpose.trim()) return;
    const controller = new AbortController();
    requestController.current = controller;
    setBusy(true);
    setError("");
    try {
      const { revision, schedule: original, ...details } = draft;
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken, "content-type": "application/json" },
        body: JSON.stringify({ ...details, expectedRevision: revision, ...(schedule && original ? { schedule: schedulePayload(schedule, original) } : {}) }), signal: controller.signal,
      });
      const result = await response.json() as { updated?: boolean; needsApproval?: boolean; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not save booking details.");
      if (!controller.signal.aborted) onSaved(result.updated === true, result.needsApproval === true);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not save booking details.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <section className="modal resource-scheduler-modal" role="dialog" aria-modal="true" aria-labelledby="booking-details-title"
      onKeyDown={(event) => { if (!busy && event.key === "Escape") onClose(); }}>
      <div className="modal-heading"><h2 id="booking-details-title">Edit booking details</h2>
        <button type="button" className="icon-button" aria-label="Close" disabled={busy} onClick={onClose}><X size={18} /></button>
      </div>
      {error && <p role="alert">{error}</p>}
      {draft ? <form onSubmit={save}>
        <label>Purpose<input required maxLength={240} value={draft.purpose} onChange={(event) => setDraft({ ...draft, purpose: event.target.value })} /></label>
        <label>Subtitle<input maxLength={240} value={draft.subtitle} onChange={(event) => setDraft({ ...draft, subtitle: event.target.value })} /></label>
        <label>Description<textarea maxLength={2000} rows={4} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        {draft.schedule && <label><input type="checkbox" checked={schedule !== null}
          onChange={(event) => setSchedule(event.target.checked ? scheduleDraft(draft.schedule!) : null)} /> Change time or quantity</label>}
        {schedule && draft.schedule && <fieldset>
          <legend>Schedule in {draft.schedule.timeZone}</legend>
          {schedule.allDayDate !== null
            ? <label>Full-day booking date<input type="date" required value={schedule.allDayDate} onChange={(event) => setSchedule({ ...schedule, allDayDate: event.target.value })} /></label>
            : <div className="resource-scheduler-field-grid">
              <label>Start<input type="datetime-local" required value={schedule.startsAt} onChange={(event) => setSchedule({ ...schedule, startsAt: event.target.value })} /></label>
              <label>End<input type="datetime-local" required value={schedule.endsAt} onChange={(event) => setSchedule({ ...schedule, endsAt: event.target.value })} /></label>
            </div>}
          <label>Quantity<input type="number" required min={1} max={draft.schedule.maxQuantity} value={schedule.quantity} onChange={(event) => setSchedule({ ...schedule, quantity: Number(event.target.value) })} /></label>
          {draft.schedule.status === "approved" && draft.schedule.requiresApproval && <p>Changing the schedule or quantity sends this booking back for approval.</p>}
        </fieldset>}
        <div className="form-actions">
          <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="button button-primary" disabled={busy || !draft.purpose.trim()}>{busy ? "Saving…" : "Save details"}</button>
        </div>
      </form> : !error && <p role="status">Loading booking details…</p>}
    </section>
  </div>;
}
