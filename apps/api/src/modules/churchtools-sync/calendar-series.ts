import { createHash } from "node:crypto";
import { appointmentInstants, appointmentWallTime, canonicalTimeZone } from "../../calendar-time.js";

const object = (input: unknown) => input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
const id = (input: unknown) => typeof input === "number" && Number.isSafeInteger(input) && input > 0 ? String(input) : null;
const instant = (input: unknown) => typeof input === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?Z$/.test(input)
  && Number.isFinite(Date.parse(input)) && new Date(input).toISOString() === input.replace(/(?:\.000)?Z$/, ".000Z") ? Date.parse(input) : null;
const validDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && instant(`${value}T00:00:00Z`) !== null;
const patterns = new Map([[1, "daily"], [7, "weekly"], [31, "monthly"], [32, "monthly_weekday"], [365, "yearly"], [999, "manual"]]);

function readCalendarSeries(payload: unknown, calendarId: string, seriesId: string) {
  const data = object(object(payload)?.data);
  const base = object(data?.appointment);
  const calendar = object(base?.calendar);
  if (!base || !calendar || id(base.id) !== seriesId || id(calendar.id) !== calendarId) throw new Error("ChurchTools returned a different appointment series.");
  const pattern = typeof base.repeatId === "number" ? patterns.get(base.repeatId) : undefined;
  if (!pattern) throw new Error("Select a recurring ChurchTools appointment.");
  if (typeof base.allDay !== "boolean") throw new Error("The source series must specify whether it is all-day.");
  const calculated = object(data?.calculatedDates);
  if (!calculated) throw new Error("ChurchTools did not return calculated occurrences.");
  const entries = Object.entries(calculated).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length < 1 || entries.length > 100) throw new Error("Choose a source series with between 1 and 100 calculated occurrences.");
  if (entries.some(([day]) => !validDay(day))) throw new Error("ChurchTools returned an invalid occurrence date.");
  return { base, pattern, entries };
}

export async function readChurchToolsAllDaySeriesDates(payload: unknown, calendarId: string, seriesId: string,
  getOccurrence: (day: string) => Promise<unknown>,
) {
  const { base, entries } = readCalendarSeries(payload, calendarId, seriesId);
  const inclusiveEnds = new Map<string, string>();
  if (!base.allDay) return inclusiveEnds;
  if (typeof base.version !== "number" || !Number.isSafeInteger(base.version)) throw new Error("ChurchTools did not return the all-day series revision.");
  for (let offset = 0; offset < entries.length; offset += 5) {
    const ends = await Promise.all(entries.slice(offset, offset + 5).map(async ([day]) => {
      const detail = object(object(await getOccurrence(day))?.data);
      const appointment = object(detail?.appointment);
      const detailBase = object(appointment?.base);
      const calculated = object(appointment?.calculated);
      const end = calculated?.endDate;
      if (detailBase?.allDay !== true || id(detailBase.id) !== seriesId || id(object(detailBase.calendar)?.id) !== calendarId
        || detailBase.version !== base.version || calculated?.startDate !== day || !validDay(end) || end < day) {
        throw new Error("ChurchTools returned a mismatched all-day date or the series changed during review.");
      }
      return [day, end] as const;
    }));
    for (const [day, end] of ends) inclusiveEnds.set(day, end);
  }
  return inclusiveEnds;
}

export function reviewChurchToolsCalendarSeries(payload: unknown, calendarId: string, seriesId: string, sourceTimeZone: string,
  allDayEnds: ReadonlyMap<string, string> = new Map(),
) {
  const zone = canonicalTimeZone(sourceTimeZone);
  if (!zone) throw new Error("Enter the ChurchTools site's time zone, such as Europe/Zurich.");
  const { base, pattern, entries } = readCalendarSeries(payload, calendarId, seriesId);
  const title = typeof base.title === "string" ? base.title.trim() : "";
  if (!title || title.length > 160) throw new Error("The source series title exceeds the local title limit.");
  const subtitle = typeof base.subtitle === "string" ? base.subtitle : "";
  if (subtitle.length > 240) throw new Error("The source series subtitle exceeds the local subtitle limit.");
  const description = typeof base.description === "string" ? base.description : "";
  const allDay = base.allDay === true;
  const dates = entries.map(([date, value]) => {
    const occurrence = object(value);
    const eventId = id(object(occurrence?.event)?.id);
    if (allDay) {
      const end = allDayEnds.get(date);
      if (!validDay(end) || end < date) throw new Error("ChurchTools did not return the verified inclusive end of an all-day occurrence.");
      return { date, startsAt: `${date}T00:00:00`, endsAt: `${end}T23:59:59`, startsAtUtc: null, endsAtUtc: null, eventId };
    }
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
    return { date, startsAt, endsAt, startsAtUtc: roundTrip.startsAtUtc, endsAtUtc: roundTrip.endsAtUtc, eventId };
  });
  const { startsAt, endsAt } = dates[0];
  const localDuration = (start: string, end: string) => Date.parse(`${end}Z`) - Date.parse(`${start}Z`);
  const baseDuration = localDuration(startsAt, endsAt);
  const manualDates: string[] = [];
  const extraDates: Array<{ startsAt: string; endsAt: string }> = [];
  let hasVaryingTimes = false;
  let endsOn = dates.at(-1)!.date;
  for (const occurrence of dates) {
    const lastDay = occurrence.endsAt.slice(0, 10);
    // Native extra dates use overlap queries, so an occurrence remains visible
    // when a requested range starts after its first day.
    const standardTime = occurrence.startsAt.slice(11) === startsAt.slice(11)
      && localDuration(occurrence.startsAt, occurrence.endsAt) === baseDuration;
    if (!standardTime) hasVaryingTimes = true;
    if (occurrence.date === lastDay && standardTime) {
      manualDates.push(occurrence.date);
    } else {
      extraDates.push({ startsAt: occurrence.startsAt, endsAt: occurrence.endsAt });
    }
    if (lastDay > endsOn) endsOn = lastDay;
  }
  const recurrence = { frequency: "manual", interval: 1, endsOn, dates: manualDates };
  const review = { calendarId, seriesId, zone, title, subtitle, description, pattern, startsAt, endsAt, recurrence, dates };
  // Keep the source identity used by timed imports that predate native extra dates.
  const originalRecurrence = { frequency: "manual", interval: 1, endsOn: dates.at(-1)!.date, dates: dates.map(({ date }) => date) };
  const hashed = allDay || hasVaryingTimes ? { ...review, allDay, extraDates } : { ...review, recurrence: originalRecurrence };
  return { ...review, allDay, extraDates, sourceHash: createHash("sha256").update(JSON.stringify(hashed)).digest("hex") };
}
