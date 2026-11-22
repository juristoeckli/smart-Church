import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { CalendarAppointmentTarget } from "../../module-registry";

type CalendarLink = CalendarAppointmentTarget & { title: string; calendarName: string };

export function BookingCalendarLinks({ departmentId, bookingId, onOpen, onClose }: {
  departmentId: string;
  bookingId: string;
  onOpen: (target: CalendarAppointmentTarget) => void;
  onClose: () => void;
}) {
  const [links, setLinks] = useState<CalendarLink[]>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/modules/resource-scheduler/bookings/${bookingId}/calendar-links`, {
      headers: { "x-department-id": departmentId }, cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error();
      const data = await response.json() as CalendarLink[];
      if (!controller.signal.aborted) setLinks(data);
    }).catch(() => { if (!controller.signal.aborted) setError("Could not load linked appointments."); });
    return () => controller.abort();
  }, [bookingId, departmentId]);

  return <div className="modal-backdrop" role="presentation">
    <section className="modal resource-scheduler-modal" role="dialog" aria-modal="true" aria-labelledby="resource-linked-calendar">
      <div className="modal-heading"><h2 id="resource-linked-calendar">Linked appointments</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button></div>
      {error ? <p role="alert">{error}</p> : !links ? <p role="status">Loading appointments…</p> : !links.length ? <p>No linked appointments are available.</p>
        : <ul className="resource-scheduler-extra-dates">{links.map((link) => <li key={`${link.appointmentId}:${link.originalStartAt}`}>
          <span><strong>{link.title}</strong><small>{link.calendarName} · {link.date}</small></span>
          <button type="button" onClick={() => onOpen(link)}>Open appointment</button>
        </li>)}</ul>}
    </section>
  </div>;
}
