import { appointmentWallTime, resolveAppointmentWallTime } from "./calendar-time.js";

const wall = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
function seconds(value: string) { return value.length === 16 ? `${value}:00` : value; }
const instant = (value: number) => new Date(value).toISOString();

export function describeTimedVolunteerAbsence(startsAtUtc: string, endsAtUtc: string, timeZone: string) {
  const start = Date.parse(startsAtUtc);
  const end = Date.parse(endsAtUtc);
  return {
    startsAt: appointmentWallTime(start, timeZone), endsAt: appointmentWallTime(end, timeZone),
    startsOn: appointmentWallTime(start, timeZone).slice(0, 10),
    endsOn: appointmentWallTime(end - 1, timeZone).slice(0, 10),
  };
}

export function parseTimedVolunteerAbsence(startsAt: string, endsAt: string, timeZone: string,
  previous?: { startsAtUtc: string | null; endsAtUtc: string | null },
) {
  if (!wall.test(startsAt) || !wall.test(endsAt)) return null;
  function resolve(value: string, prior: string | null | undefined) {
    const local = seconds(value);
    const existing = prior ? Date.parse(prior) : NaN;
    if (Number.isFinite(existing) && appointmentWallTime(existing, timeZone) === local) return { instant: existing, shifted: false };
    return resolveAppointmentWallTime(local, timeZone);
  }
  const start = resolve(startsAt, previous?.startsAtUtc);
  const end = resolve(endsAt, previous?.endsAtUtc);
  // Keep the site's calendar policy for repeated clocks and reject missing clocks.
  if (!start || !end || start.shifted || end.shifted || start.instant >= end.instant) return null;
  const startsAtUtc = instant(start.instant);
  const endsAtUtc = instant(end.instant);
  return { ...describeTimedVolunteerAbsence(startsAtUtc, endsAtUtc, timeZone), startsAtUtc, endsAtUtc };
}

export function volunteerEventWindow(date: string, allDay: boolean, from: string | null, to: string | null, timeZone: string) {
  const next = new Date(Date.parse(date) + 86_400_000).toISOString().slice(0, 10);
  const start = resolveAppointmentWallTime(`${date}T${allDay ? "00:00:00" : from ?? "00:00:00"}`, timeZone);
  const end = allDay ? resolveAppointmentWallTime(`${next}T00:00:00`, timeZone)
    : to ? resolveAppointmentWallTime(`${date}T${to}`, timeZone) : null;
  return {
    startsAtUtc: start ? instant(start.instant) : null,
    endsAtUtc: start && end && end.instant > start.instant ? instant(end.instant) : null,
  };
}
