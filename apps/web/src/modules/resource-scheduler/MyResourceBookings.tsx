import { ResourceCalendarSubscription } from "./ResourceCalendarSubscription";
import { useEffect, useState } from "react";

type Period = "upcoming" | "past";
type Status = "requested" | "approved" | "declined" | "cancelled";
type Booking = { id: string; resourceName: string; location: string; purpose: string; subtitle?: string; description?: string; beneficiaryName?: string | null; quantity: number; status: Status; allDayDate?: string | null; startsAt: string; endsAt: string };
type BookingPage = { bookings: Booking[]; nextCursor: string | null; timeZone: string };

export function MyResourceBookings({ departmentId, csrfToken, refreshVersion, statusLabels, onHistory }: {
  departmentId: string;
  csrfToken: string;
  refreshVersion: number;
  statusLabels: Record<Status, string>;
  onHistory: (id: string, name: string) => void;
}) {
  const [period, setPeriod] = useState<Period>("upcoming");
  const [status, setStatus] = useState<Status | "">("");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ scope: string; data: BookingPage } | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const cursor = cursors.at(-1);
  const scope = JSON.stringify([departmentId, period, status, cursor, refreshVersion, reload]);
  const page = result?.scope === scope ? result.data : null;
  const error = failure?.scope === scope ? failure.message : "";

  useEffect(() => {
    const controller = new AbortController();
    const search = new URLSearchParams({ period });
    if (status) search.set("status", status);
    if (cursor) search.set("cursor", cursor);
    async function load() {
      try {
        const response = await fetch("/api/modules/resource-scheduler/my-bookings?" + search, {
          headers: { "x-department-id": departmentId }, cache: "no-store", signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load your bookings.");
        if (!controller.signal.aborted) setResult({ scope, data });
      } catch (reason) {
        if (!controller.signal.aborted) setFailure({ scope, message: reason instanceof Error ? reason.message : "Could not load your bookings." });
      }
    }
    void load();
    return () => controller.abort();
  }, [cursor, departmentId, period, scope, status]);

  const formatter = page ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: page.timeZone }) : null;
  return <section className="resource-scheduler-booked-days" aria-labelledby="resource-my-bookings">
    <h2 id="resource-my-bookings">My bookings</h2>
    <ResourceCalendarSubscription key={departmentId} departmentId={departmentId} csrfToken={csrfToken} />
    <div className="resource-scheduler-filters">
      <label>Time period<select value={period} onChange={event => { setPeriod(event.target.value as Period); setCursors([null]); }}>
        <option value="upcoming">Upcoming and in progress</option>
        <option value="past">Past</option>
      </select></label>
      <label>Status<select value={status} onChange={event => { setStatus(event.target.value as Status | ""); setCursors([null]); }}>
        <option value="">All statuses</option>
        {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
    </div>
    {error && <p role="alert" className="resource-scheduler-message is-error">{error} <button type="button" className="button button-secondary" onClick={() => setReload(value => value + 1)}>Retry</button></p>}
    {!page && !error && <p role="status">Loading your bookings…</p>}
    {page && (page.bookings.length ? <div className="resource-scheduler-matrix-wrap">
      <table className="resource-scheduler-booked-days-table">
        <thead><tr><th scope="col">Resource</th><th scope="col">Booking</th><th scope="col">Starts · {page.timeZone}</th><th scope="col">Ends</th><th scope="col">Status</th><th scope="col">History</th></tr></thead>
        <tbody>{page.bookings.map(booking => <tr key={booking.id}>
          <th scope="row">{booking.resourceName}{booking.location && <small>{booking.location}</small>}</th>
          <td>{booking.purpose}{booking.beneficiaryName && <small>On behalf of {booking.beneficiaryName}</small>}{booking.subtitle && <small>{booking.subtitle}</small>}{booking.description && <details className="resource-booking-description"><summary>Description</summary><p>{booking.description}</p></details>}<small>{booking.quantity} {booking.quantity === 1 ? "unit" : "units"}</small></td>
          {booking.allDayDate ? <td colSpan={2}><time dateTime={booking.allDayDate}>{booking.allDayDate}</time> · All day</td> : <>
            <td>{formatter?.format(new Date(booking.startsAt))}</td>
            <td>{formatter?.format(new Date(booking.endsAt))}</td>
          </>}
          <td>{statusLabels[booking.status]}</td>
          <td><button type="button" className="button button-secondary" onClick={() => onHistory(booking.id, booking.resourceName)}>Booking history</button></td>
        </tr>)}</tbody>
      </table>
    </div> : <p>No bookings match the selected filters.</p>)}
    {(cursors.length > 1 || page?.nextCursor) && <nav className="resource-scheduler-week" aria-label="My bookings pages">
      <button type="button" className="button button-secondary" disabled={cursors.length === 1} onClick={() => setCursors(current => current.slice(0, -1))}>Previous</button>
      <span>Page {cursors.length}</span>
      <button type="button" className="button button-secondary" disabled={!page?.nextCursor} onClick={() => {
        if (page?.nextCursor) setCursors(current => [...current, page.nextCursor]);
      }}>Next</button>
    </nav>}
  </section>;
}
