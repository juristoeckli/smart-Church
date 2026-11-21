import { appointmentInstants } from "./calendar-time.js";

type Frequency = "daily" | "weekly" | "monthly" | "monthly_weekday" | "yearly" | "manual";
export type Recurrence = { frequency: Frequency; interval?: number; weekdays?: number[]; weekday?: number; weekOfMonth?: number; endsOn?: string; count?: number; dates?: string[] };
export function cleanLocalDateTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(" ", "T").slice(0, 19);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(cleaned)) return null;
  const wallTime = cleaned.length === 16 ? `${cleaned}:00` : cleaned;
  const date = new Date(`${wallTime}Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19) === wallTime ? wallTime : null;
}

export function wallDate(value: string) {
  return new Date(`${value.replace(" ", "T").slice(0, 19)}Z`);
}

export function localDateTime(date: Date) {
  const p = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}T${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())}`;
}

export function startOfDay(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00Z`);
}

export function addDays(date: Date, amount: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + amount);
  return result;
}

export function occurrenceStarts(row: { starts_at: string; recurrence: Recurrence | null }, from: string, to: string, maxOccurrences = 500): Date[] {
  const start = new Date(`${row.starts_at.replace(" ", "T")}Z`);
  const fromDate = startOfDay(from);
  const toDate = startOfDay(to);
  const rule = row.recurrence;
  if (!rule) return start >= new Date(`${from.replace(" ", "T")}Z`) && start <= new Date(`${to.replace(" ", "T")}Z`) ? [start] : [];
  const byManualDate = (date: string) => {
    const candidate = new Date(`${date.slice(0, 10)}T${row.starts_at.slice(11, 19)}Z`);
    return Number.isFinite(candidate.getTime()) ? candidate : null;
  };
  if (rule.frequency === "manual") {
    const through = addDays(rule.endsOn ? new Date(Math.min(startOfDay(rule.endsOn).getTime(), toDate.getTime())) : toDate, 1);
    const requestedDates = [...new Set(rule.dates ?? [])].sort();
    return requestedDates.map(byManualDate).filter((date): date is Date => Boolean(date && date >= start && date < through))
      .slice(0, rule.count ?? requestedDates.length).filter((date) => date >= fromDate).slice(0, maxOccurrences);
  }
  const dates: Date[] = [];
  const interval = Math.min(365, Math.max(1, Math.floor(Number(rule.interval) || 1)));
  const endsOn = rule.endsOn ? startOfDay(rule.endsOn) : toDate;
  const last = new Date(Math.min(toDate.getTime(), endsOn.getTime()));
  let occurrenceCount = 0;
  const first = startOfDay(row.starts_at);
  for (let day = !rule.count && fromDate > first ? fromDate : first; day <= last && dates.length < maxOccurrences; day = addDays(day, 1)) {
    const delta = Math.round((startOfDay(localDateTime(day).slice(0, 10)).getTime() - startOfDay(row.starts_at.slice(0, 10)).getTime()) / 86_400_000);
    const months = (day.getUTCFullYear() - start.getUTCFullYear()) * 12 + day.getUTCMonth() - start.getUTCMonth();
    let matches = false;
    if (rule.frequency === "daily") matches = delta % interval === 0;
    else if (rule.frequency === "weekly") {
      const monday = (value: Date) => { const copy = startOfDay(localDateTime(value)); copy.setUTCDate(copy.getUTCDate() - ((copy.getUTCDay() + 6) % 7)); return copy; };
      const weekDelta = Math.round((monday(day).getTime() - monday(start).getTime()) / (7 * 86_400_000));
      matches = weekDelta % interval === 0 && (rule.weekdays?.length ? rule.weekdays.includes(day.getUTCDay()) : day.getUTCDay() === start.getUTCDay());
    } else if (rule.frequency === "monthly") matches = months >= 0 && months % interval === 0 && day.getUTCDate() === start.getUTCDate();
    else if (rule.frequency === "monthly_weekday") {
      const ordinal = rule.weekOfMonth;
      const weekday = rule.weekday;
      const ordinalMatches = ordinal === -1
        ? addDays(day, 7).getUTCMonth() !== day.getUTCMonth()
        : Math.floor((day.getUTCDate() - 1) / 7) + 1 === ordinal;
      matches = months >= 0 && months % interval === 0 && weekday !== undefined && day.getUTCDay() === weekday && ordinalMatches;
    }
    else if (rule.frequency === "yearly") matches = day.getUTCMonth() === start.getUTCMonth() && day.getUTCDate() === start.getUTCDate() && (day.getUTCFullYear() - start.getUTCFullYear()) % interval === 0;
    if (!matches || day < startOfDay(row.starts_at)) continue;
    occurrenceCount += 1;
    if (rule.count && occurrenceCount > rule.count) break;
    if (day >= fromDate) {
      const occurrence = new Date(day);
      occurrence.setUTCHours(start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), 0);
      dates.push(occurrence);
    }
  }
  return dates;
}


export function calendarOccurrenceExists(row: { starts_at: string; recurrence: Recurrence | null }, original: string) {
  if (original < row.starts_at || original.slice(11) !== row.starts_at.slice(11)) return false;
  const day = original.slice(0, 10);
  return occurrenceStarts(row, `${day}T00:00:00`, `${day}T23:59:59`).some((date) => localDateTime(date) === original);
}

export function calendarBookingWindow(startsAt: string, endsAt: string, allDay: boolean, timeZone: string) {
  if (allDay) {
    const startDay = startOfDay(startsAt);
    const endDay = startOfDay(endsAt);
    const endMidnight = wallDate(endsAt) > endDay ? addDays(endDay, 1) : endDay;
    const exclusiveEnd = endMidnight > startDay ? endMidnight : addDays(startDay, 1);
    return appointmentInstants(localDateTime(startDay), localDateTime(exclusiveEnd), timeZone);
  }
  return appointmentInstants(startsAt, endsAt, timeZone);
}
