const wallTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

export function canonicalTimeZone(value: unknown): string | null {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_+/-]{0,79}$/.test(value)) return null;
  try {
    return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  const existing = formatters.get(timeZone);
  if (existing) return existing;
  const value = new Intl.DateTimeFormat("en-CA", {
    timeZone, calendar: "iso8601", numberingSystem: "latn", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  formatters.set(timeZone, value);
  return value;
}

export function appointmentWallTime(instant: number, timeZone: string) {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(instant).map(({ type, value }) => [type, value]));
  return `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

function wallTimeValue(value: string): number | null {
  if (!wallTimePattern.test(value)) return null;
  const instant = Date.parse(`${value}Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 19) === value ? instant : null;
}

export function resolveAppointmentWallTime(value: string, timeZone: string) {
  const target = wallTimeValue(value);
  if (target === null) return null;
  const offsets = new Set<number>();
  for (const hours of [-36, 0, 36]) {
    const sample = target + hours * 3_600_000;
    offsets.add(Date.parse(`${appointmentWallTime(sample, timeZone)}Z`) - sample);
  }
  const candidates = [...offsets].map((offset) => {
    const instant = target - offset;
    return { instant, wall: Date.parse(`${appointmentWallTime(instant, timeZone)}Z`) };
  });
  // PostgreSQL resolves a repeated clock time to the later instant and shifts a
  // missing clock time forward by the gap. Match that policy for generated dates.
  const exact = candidates.filter((candidate) => candidate.wall === target);
  if (exact.length) return { instant: Math.max(...exact.map((candidate) => candidate.instant)), shifted: false };
  const next = candidates.filter((candidate) => candidate.wall > target).sort((a, b) => a.wall - b.wall)[0];
  return next ? { instant: next.instant, shifted: true } : null;
}

export function appointmentInstants(startsAt: string, endsAt: string, timeZone: string) {
  const start = resolveAppointmentWallTime(startsAt, timeZone);
  const end = resolveAppointmentWallTime(endsAt, timeZone);
  if (!start || !end) return null;
  const duration = Date.parse(`${endsAt}Z`) - Date.parse(`${startsAt}Z`);
  if (duration < 0) return null;
  const endInstant = duration > 0 && (start.shifted || end.instant <= start.instant)
    ? start.instant + duration
    : end.instant;
  return { startsAtUtc: new Date(start.instant).toISOString(), endsAtUtc: new Date(endInstant).toISOString(), shifted: start.shifted || end.shifted };
}
