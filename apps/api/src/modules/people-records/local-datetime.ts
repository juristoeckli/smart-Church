// Store civil date and time without applying the browser, server, or database time zone.
export function normalizePeopleLocalDateTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(?!0000)(\d{4}-\d{2}-\d{2})[T ]([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(value);
  if (!match) return null;
  const [, day, hours, minutes, seconds = "00"] = match;
  const validatedDay = new Date(day + "T00:00:00Z");
  if (Number.isNaN(validatedDay.getTime()) || validatedDay.toISOString().slice(0, 10) !== day) return null;
  return day + "T" + hours + ":" + minutes + ":" + seconds;
}
