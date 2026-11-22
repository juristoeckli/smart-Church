import { useEffect, useRef, useState } from "react";

type ReservationDescription = { description: string; revision: string };

export function CalendarBookingDescription({ appointmentId, originalStart, bookingId, departmentId, csrfToken }: {
  appointmentId: string; originalStart: string; bookingId: string; departmentId: string; csrfToken: string;
}) {
  const [draft, setDraft] = useState<ReservationDescription | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const endpoint = `/api/modules/church-calendar/appointments/${appointmentId}/occurrences/${encodeURIComponent(originalStart)}/resource-bookings/${bookingId}/description`;
  useEffect(() => () => { request.current?.abort(); }, []);

  async function update(method: "GET" | "PUT") {
    if (pending) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method, cache: "no-store", signal: controller.signal,
        headers: { "x-department-id": departmentId, ...(method === "PUT" && { "x-csrf-token": csrfToken, "content-type": "application/json" }) },
        ...(method === "PUT" && draft && { body: JSON.stringify({ description: draft.description, expectedRevision: draft.revision }) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not edit the reservation description.");
      if (controller.signal.aborted) return;
      if (method === "GET") setDraft(result as ReservationDescription);
      else {
        setDraft(null);
        setMessage(result.updated ? "Reservation description saved." : "Reservation description is unchanged.");
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not edit the reservation description.");
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }

  return <div className="church-calendar-booking-description">
    {draft ? <>
      <label>Reservation description<textarea value={draft.description} rows={3} maxLength={2000} disabled={pending}
        onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
      <small>This description follows the booking’s visibility in Resources.</small>
      <div className="form-actions">
        <button className="button button-secondary" type="button" disabled={pending} onClick={() => { setDraft(null); setError(""); }}>Cancel edit</button>
        <button className="button button-primary" type="button" disabled={pending} onClick={() => void update("PUT")}>Save reservation description</button>
      </div>
    </> : <button className="button button-secondary" type="button" disabled={pending} onClick={() => void update("GET")}>Edit reservation description</button>}
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}
