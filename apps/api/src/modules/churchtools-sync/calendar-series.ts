import { createHash } from "node:crypto";
import { appointmentInstants, appointmentWallTime, canonicalTimeZone } from "../../calendar-time.js";

const object = (input: unknown) => input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
const id = (input: unknown) => typeof input === "number" && Number.isSafeInteger(input) && input > 0 ? String(input) : null;
const instant = (input: unknown) => typeof input === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?Z$/.test(input)
  && Number.isFinite(Date.parse(input)) && new Date(input).toISOString() === input.replace(/(?:\.000)?Z$/, ".000Z") ? Date.parse(input) : null;
const patterns = new Map([[1, "daily"], [7, "weekly"], [31, "monthly"], [32, "monthly_weekday"], [365, "yearly"], [999, "manual"]]);

export function reviewChurchToolsCalendarSeries(payload: unknown, calendarId: string, seriesId: string, sourceTimeZone: string) {
  const zone = canonicalTimeZone(sourceTimeZone);
  if (!zone) throw new Error("Enter the ChurchTools site's time zone, such as Europe/Zurich.");
  const data = object(object(payload)?.data);
  const base = object(data?.appointment);
  const calendar = object(base?.calendar);
  if (!base || !calendar || id(base.id) !== seriesId || id(calendar.id) !== calendarId) throw new Error("ChurchTools returned a different appointment series.");
  const pattern = typeof base.repeatId === "number" ? patterns.get(base.repeatId) : undefined;
  if (!pattern) throw new Error("Select a recurring ChurchTools appointment.");
  if (base.allDay !== false) throw new Error("Choose a timed series. All-day series require separate end-date handling.");
  const title = typeof base.title === "string" ? base.title.trim() : "";
  if (!title || title.length > 160) throw new Error("The source series title exceeds the local title limit.");
  const subtitle = typeof base.subtitle === "string" ? base.subtitle : "";
  if (subtitle.length > 240) throw new Error("The source series subtitle exceeds the local subtitle limit.");
  const description = typeof base.description === "string" ? base.description : "";
  const calculated = object(data?.calculatedDates);
  if (!calculated) throw new Error("ChurchTools did not return calculated occurrences.");
  const entries = Object.entries(calculated).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length < 1 || entries.length > 100) throw new Error("Choose a source series with between 1 and 100 calculated occurrences.");
  const dates = entries.map(([date, value]) => {
    const occurrence = object(value);
    const start = instant(occurrence?.startDate);
    const end = instant(occurrence?.endDate);
    if (start === null || end === null || end <= start) throw new Error("ChurchTools returned an invalid occurrence time.");
    const startsAt = appointmentWallTime(start, zone);
    const endsAt = appointmentWallTime(end, zone);
    const roundTrip = appointmentInstants(startsAt, endsAt, zone);
    if (startsAt.slice(0, 10) !== date || roundTrip?.startsAtUtc !== new Date(start).toISOString()
      || roundTrip.endsAtUtc !== new Date(end).toISOString()) {
      throw new Error("An occurrence cannot be represented exactly in the confirmed local time zone.");
    }
    return { date, startsAt, endsAt, startsAtUtc: roundTrip.startsAtUtc, endsAtUtc: roundTrip.endsAtUtc,
      eventId: id(object(occurrence?.event)?.id) };
  });
  const { startsAt, endsAt } = dates[0];
  const localDuration = (start: string, end: string) => Date.parse(`${end}Z`) - Date.parse(`${start}Z`);
  if (dates.some((date) => date.startsAt.slice(11) !== startsAt.slice(11)
    || localDuration(date.startsAt, date.endsAt) !== localDuration(startsAt, endsAt))) {
    throw new Error("Occurrence times vary within this series. Review those dates separately.");
  }
  const recurrence = { frequency: "manual", interval: 1, endsOn: dates.at(-1)!.date, dates: dates.map(({ date }) => date) };
  const review = { calendarId, seriesId, zone, title, subtitle, description, pattern, startsAt, endsAt, recurrence, dates };
  return { ...review, sourceHash: createHash("sha256").update(JSON.stringify(review)).digest("hex") };
}
