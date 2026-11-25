import { useEffect, useState } from "react";
import type { CalendarAppointmentTarget } from "./module-registry";

type SignupAppointmentLink = CalendarAppointmentTarget & { title: string; calendarName: string };

export function GroupSignupAppointments({ departmentId, groupId, onOpen }: {
  departmentId: string; groupId: string; onOpen: (target: CalendarAppointmentTarget) => void;
}) {
  const [links, setLinks] = useState<SignupAppointmentLink[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    setLinks([]);
    void fetch("/api/modules/church-calendar/signup-groups/" + groupId + "/appointments", {
      headers: { "x-department-id": departmentId }, cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      const data = response.ok ? await response.json() as SignupAppointmentLink[] : [];
      if (!controller.signal.aborted) setLinks(data);
    }).catch(() => {
      if (!controller.signal.aborted) setLinks([]);
    });
    return () => controller.abort();
  }, [departmentId, groupId]);
  if (!links.length) return null;
  return <section className="event-details-section">
    <h3>Linked Calendar appointments</h3>
    <ul>{links.map((link) => <li key={link.appointmentId + ":" + link.originalStartAt}>
      <span><strong>{link.title}</strong> · {link.calendarName} · {link.date}</span>
      <button type="button" className="button button-secondary" onClick={() => onOpen(link)}>Open appointment</button>
    </li>)}</ul>
  </section>;
}
