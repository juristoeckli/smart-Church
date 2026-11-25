import type { CalendarAppointmentTarget, CheckInAppointmentTarget } from "./module-registry";

export function checkInLocationDate(timeZone: string, instant = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)?.value).join("-");
}

export function checkInAppointmentTarget(appointment: {
  appointmentId: string;
  originalOccurrenceStartAt?: string;
  occurrenceStartAt: string;
  startsAtUtc?: string | null;
  allDay: boolean;
}, departmentId: string, timeZone: string): CheckInAppointmentTarget {
  const instant = !appointment.allDay && appointment.startsAtUtc ? new Date(appointment.startsAtUtc) : null;
  const date = instant && !Number.isNaN(instant.getTime()) ? checkInLocationDate(timeZone, instant) : appointment.occurrenceStartAt.slice(0, 10);
  return { appointmentId: appointment.appointmentId, originalStartAt: appointment.originalOccurrenceStartAt ?? appointment.occurrenceStartAt, departmentId, date };
}

export function checkInOccurrenceKey(target: Pick<CalendarAppointmentTarget, "appointmentId" | "originalStartAt">) {
  return target.appointmentId + ":" + target.originalStartAt;
}
