import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";

type BookingDetails = { purpose: string; subtitle: string; description: string; revision: string };

export function BookingDetailsDialog({ departmentId, bookingId, csrfToken, onClose, onSaved }: {
  departmentId: string; bookingId: string; csrfToken: string; onClose: () => void; onSaved: (changed: boolean) => void;
}) {
  const [draft, setDraft] = useState<BookingDetails | null>(null);
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
      const { revision, ...details } = draft;
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken, "content-type": "application/json" },
        body: JSON.stringify({ ...details, expectedRevision: revision }), signal: controller.signal,
      });
      const result = await response.json() as { updated?: boolean; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not save booking details.");
      if (!controller.signal.aborted) onSaved(result.updated === true);
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
        <div className="form-actions">
          <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="button button-primary" disabled={busy || !draft.purpose.trim()}>{busy ? "Saving…" : "Save details"}</button>
        </div>
      </form> : !error && <p role="status">Loading booking details…</p>}
    </section>
  </div>;
}
