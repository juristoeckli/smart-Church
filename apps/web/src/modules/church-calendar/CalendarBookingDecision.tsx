import { useEffect, useRef, useState } from "react";

type OpenStatus = "requested" | "approved";
type Decision = "approved" | "declined" | "cancelled";

export function CalendarBookingDecision({ appointmentId, originalStart, bookingId, departmentId, csrfToken, status, timeMismatch, onChanged }: {
  appointmentId: string; originalStart: string; bookingId: string; departmentId: string; csrfToken: string;
  status: OpenStatus; timeMismatch?: boolean; onChanged: (status: Decision) => void;
}) {
  const [selection, setSelection] = useState<{ status: Decision; expectedStatus: OpenStatus }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  function choose(decision: Decision) {
    setError("");
    setSelection({ status: decision, expectedStatus: status });
  }

  async function save() {
    if (!selection || saving) return;
    const controller = new AbortController();
    request.current = controller;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/modules/church-calendar/appointments/" + appointmentId + "/occurrences/"
        + encodeURIComponent(originalStart) + "/resource-bookings/" + bookingId + "/status", {
        method: "PUT", signal: controller.signal,
        headers: { "x-department-id": departmentId, "x-csrf-token": csrfToken, "content-type": "application/json" },
        body: JSON.stringify(selection),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The reservation status could not be changed.");
      if (controller.signal.aborted) return;
      setSelection(undefined);
      onChanged(selection.status);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "The reservation status could not be changed.");
    } finally {
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  return <div className="church-calendar-booking-description">
    {selection ? <>
      <p>{selection.status === "cancelled" ? "Release this resource reservation?" : selection.status === "approved"
        ? "Approve this resource reservation?" : "Decline this resource request?"}</p>
      <div className="form-actions">
        <button type="button" className="button button-secondary" disabled={saving} onClick={() => { setSelection(undefined); setError(""); }}>Back</button>
        <button type="button" className="button button-primary" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : selection.status === "cancelled" ? "Confirm cancellation" : selection.status === "approved" ? "Confirm approval" : "Confirm decline"}
        </button>
      </div>
    </> : <div className="form-actions">
      {status === "requested" && <>
        <button type="button" className="button button-secondary" disabled={timeMismatch} onClick={() => choose("approved")}>Approve reservation</button>
        <button type="button" className="button button-secondary" onClick={() => choose("declined")}>Decline request</button>
      </>}
      <button type="button" className="button button-secondary" onClick={() => choose("cancelled")}>Cancel reservation</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
