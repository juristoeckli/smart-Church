import { useEffect, useState } from "react";
import { X } from "lucide-react";

export type BookingAuditEntry = { id: string; action: string; details: Record<string, unknown>; createdAt: string; actorName: string | null };

const actionLabels: Record<string, string> = {
  booking_approved: "Booking approved", booking_declined: "Booking rejected", booking_cancelled: "Booking cancelled",
  series_created: "Series created", series_archived: "Series cancelled", series_future_edited: "Future bookings changed",
  occurrence_overridden: "Occurrence changed", occurrence_override_reset: "Occurrence reset",
  extra_date_added: "Extra date added", extra_date_removed: "Extra date removed", date_excluded: "Date skipped",
};
const statusLabels: Record<string, string> = {
  requested: "Pending", approved: "Confirmed", declined: "Rejected", cancelled: "Cancelled",
};

function detailFields(details: Record<string, unknown>) {
  const fields: Array<[string, string]> = [];
  for (const [key, label] of [["quantity", "Units"], ["leadInMinutes", "Setup"], ["cleanupMinutes", "Cleanup"], ["occurrenceCount", "Occurrences"], ["cancelledBookings", "Cancelled bookings"]]) {
    const value = details[key];
    if (typeof value === "number") fields.push([label, key.endsWith("Minutes") ? `${value} min` : String(value)]);
  }
  if (typeof details.status === "string" && statusLabels[details.status]) fields.push(["Status", statusLabels[details.status]]);
  if (typeof details.date === "string") fields.push(["Date", details.date]);
  if (typeof details.fromDate === "string") fields.push(["From", details.fromDate]);
  return fields;
}

function AuditList({ entries, empty }: { entries: BookingAuditEntry[]; empty: string }) {
  if (!entries.length) return <p className="resource-scheduler-empty">{empty}</p>;
  return <ol className="resource-scheduler-history">{entries.map((entry) => {
    const sections: Array<{ label: string; fields: Array<[string, string]> }> = [{ label: "", fields: detailFields(entry.details) }];
    for (const [key, label] of [["previous", "Before"], ["next", "After"], ["restored", "Restored"]]) {
      const details = entry.details[key];
      if (details && typeof details === "object" && !Array.isArray(details)) sections.push({ label, fields: detailFields(details as Record<string, unknown>) });
    }
    return <li key={entry.id}>
      <strong>{actionLabels[entry.action] ?? entry.action.replaceAll("_", " ")}</strong>
      <small>{entry.actorName ?? "Actor unavailable"} · {new Date(entry.createdAt).toLocaleString()}</small>
      {sections.filter(({ fields }) => fields.length > 0).map(({ label, fields }) => <p key={label}>{label && <strong>{label}: </strong>}{fields.map(([name, value]) => `${name}: ${value}`).join(" · ")}</p>)}
      {Object.keys(entry.details).length > 0 && <details><summary>Recorded details</summary><pre>{JSON.stringify(entry.details, null, 2)}</pre></details>}
    </li>;
  })}</ol>;
}

export function BookingAuditDialog({ departmentId, bookingId, title, onClose }: { departmentId: string; bookingId: string; title: string; onClose: () => void }) {
  const [entries, setEntries] = useState<BookingAuditEntry[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/modules/resource-scheduler/bookings/${encodeURIComponent(bookingId)}/audit`, {
          headers: { "x-department-id": departmentId }, cache: "no-store", signal: controller.signal,
        });
        const result = await response.json() as BookingAuditEntry[] | { error?: string };
        if (!response.ok || !Array.isArray(result)) throw new Error(!Array.isArray(result) && result.error ? result.error : "Could not load booking history.");
        if (!controller.signal.aborted) setEntries(result);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load booking history.");
      }
    }
    void load();
    return () => controller.abort();
  }, [bookingId, departmentId]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="modal resource-scheduler-modal" role="dialog" aria-modal="true" aria-labelledby="booking-audit-title" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <div className="modal-heading"><div><span className="eyebrow">{title}</span><h2 id="booking-audit-title">Booking history</h2></div><button className="icon-button" autoFocus type="button" aria-label="Close" onClick={onClose}><X size={18} /></button></div>
      {error ? <p role="alert">{error}</p> : entries ? <AuditList entries={entries} empty="No changes have been recorded for this booking." /> : <p role="status">Loading booking history…</p>}
    </section>
  </div>;
}

export { AuditList };
