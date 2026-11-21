import { addDays, calendarOccurrenceExists, localDateTime, occurrenceStarts, startOfDay, wallDate, type Recurrence } from "./calendar-occurrences.js";

type Series = { starts_at: string; ends_at: string; recurrence: Recurrence };
export type ExplicitDate = { startsAt: string; endsAt: string };
const sortedUnique = (dates: string[]) => [...new Set(dates)].sort();

function endOfPreviousDay(boundary: string) {
  return addDays(startOfDay(boundary), -1).toISOString().slice(0, 10);
}

function manualOccurrences(series: Series) {
  const duration = wallDate(series.ends_at).getTime() - wallDate(series.starts_at).getTime();
  return occurrenceStarts(series, series.starts_at, "9999-12-31T23:59:59").map((start) => ({
    startsAt: localDateTime(start), endsAt: localDateTime(new Date(start.getTime() + duration)),
  }));
}

export function truncateCalendarSeries(series: Series, boundary: string) {
  const day = boundary.slice(0, 10);
  const recurrence = series.recurrence;
  if (recurrence.frequency === "manual") {
    // Explicit dates distinguish two occurrences on the same day.
    const dates = manualOccurrences(series).filter(({ startsAt }) => startsAt < boundary).map(({ startsAt }) => startsAt.slice(0, 10));
    // Extra dates are range-filtered by their own window, independently of this rule.
    return { ...recurrence, count: undefined, endsOn: day, dates };
  }
  const sameDayStart = day + series.starts_at.slice(10);
  const cutoff = sameDayStart < boundary && calendarOccurrenceExists(series, sameDayStart) ? day : endOfPreviousDay(boundary);
  return { ...recurrence, endsOn: recurrence.endsOn && recurrence.endsOn < cutoff ? recurrence.endsOn : cutoff };
}

export function planCalendarSeriesSplit(series: Series, boundary: string, next: ExplicitDate, requested: Recurrence,
  extras: ExplicitDate[],
) {
  const futureExtras = extras.filter(({ startsAt }) => startsAt >= boundary);
  const originalExtras = new Set(extras.map(({ startsAt }) => startsAt));
  const originalExists = (start: string) => originalExtras.has(start) || calendarOccurrenceExists(series, start);
  if (!originalExists(boundary) || (next.startsAt !== boundary && originalExists(next.startsAt)) || next.startsAt < series.starts_at) return null;
  const previousRule = truncateCalendarSeries(series, boundary);
  const sameManualRule = series.recurrence.frequency === "manual" && requested.frequency === "manual";
  const preserveManual = sameManualRule && requested.count === series.recurrence.count;
  const retainedExtras = futureExtras.filter(({ startsAt }) => startsAt !== boundary);
  let futureRule = requested;
  let addedExtras: ExplicitDate[] = [];
  if (preserveManual) {
    const chosenDays = new Set(requested.dates ?? []);
    const nextDuration = wallDate(next.endsAt).getTime() - wallDate(next.startsAt).getTime();
    const explicit = manualOccurrences(series).filter(({ startsAt }) => startsAt > boundary && chosenDays.has(startsAt.slice(0, 10))
      && (!requested.endsOn || startsAt.slice(0, 10) <= requested.endsOn));
    // Preserve the neighboring clocks and durations even when the split point
    // was an extra date with a different time from the old regular dates.
    const manualDates = [next.startsAt.slice(0, 10)];
    for (const date of explicit) {
      if (retainedExtras.some(({ startsAt }) => startsAt === date.startsAt)) continue;
      const day = date.startsAt.slice(0, 10);
      const duration = wallDate(date.endsAt).getTime() - wallDate(date.startsAt).getTime();
      if (date.startsAt >= next.startsAt && date.startsAt.slice(11) === next.startsAt.slice(11) && duration === nextDuration) manualDates.push(day);
      else addedExtras.push(date);
    }
    const sourceDays = new Set(series.recurrence.dates ?? []);
    for (const day of chosenDays) if (day >= next.startsAt.slice(0, 10) && !sourceDays.has(day)) manualDates.push(day);
    futureRule = { ...requested, count: undefined, dates: sortedUnique(manualDates) };
  } else if (requested.frequency === "manual") {
    futureRule = { ...requested, dates: sortedUnique([...(requested.dates ?? []).filter((day) => day > next.startsAt.slice(0, 10)), next.startsAt.slice(0, 10)]) };
  }
  if (requested.frequency !== "manual" && requested.frequency === series.recurrence.frequency && requested.count
    && requested.count === series.recurrence.count) {
    const pastCount = occurrenceStarts(series, series.starts_at, boundary, requested.count)
      .filter((date) => localDateTime(date) < boundary).length;
    const remaining = requested.count - pastCount;
    futureRule = remaining ? { ...requested, count: remaining } : {
      frequency: "manual", endsOn: next.startsAt.slice(0, 10), dates: [next.startsAt.slice(0, 10)],
    };
  }
  const future = { starts_at: next.startsAt, recurrence: futureRule };
  if (!calendarOccurrenceExists(future, next.startsAt)) addedExtras.push(next);
  const futureExtraStarts = new Set([...retainedExtras, ...addedExtras].map(({ startsAt }) => startsAt));
  const targetOccurrence = (original: string) => {
    if (!originalExists(original)) return null;
    const mapped = original === boundary ? next.startsAt : original;
    return futureExtraStarts.has(mapped) || calendarOccurrenceExists(future, mapped) ? mapped : null;
  };
  return { previousRule, futureRule, retainedExtras, addedExtras, targetOccurrence };
}
