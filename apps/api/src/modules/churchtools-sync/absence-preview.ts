import { volunteerAbsenceDay } from "../../event-volunteer-absences.js";

const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

function utcClock(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?Z$/.test(value)) return null;
  const instant = Date.parse(value);
  const normalized = value.replace(/(?:\.000)?Z$/, ".000Z");
  return Number.isFinite(instant) && new Date(instant).toISOString() === normalized ? normalized : null;
}

export function readChurchToolsAbsencePreview(payload: unknown, personId: string, from: string, through: string) {
  const root = object(payload);
  const records = root?.data;
  if (!Array.isArray(records) || records.length > 250 || object(root?.meta)?.count !== records.length) {
    throw new Error("ChurchTools must return a complete list of up to 250 visible absences. Choose a narrower range.");
  }
  const seen = new Set<number>();
  const dates: Array<{ sourceId: string; sourceStartDate: string; sourceEndDate: string; timed: boolean; startUtc?: string; endUtc?: string }> = [];
  let unsupported = 0;
  for (const value of records) {
    const row = object(value);
    const person = object(row?.person);
    if (!row || person?.domainType !== "person" || person.domainIdentifier !== personId
      || typeof row.id !== "number" || !Number.isSafeInteger(row.id) || row.id <= 0 || seen.has(row.id)) {
      throw new Error("ChurchTools returned a mismatched or duplicate absence record.");
    }
    seen.add(row.id);
    const { startDate, endDate, startTime, endTime } = row;
    const allDay = startTime === null && endTime === null;
    const timed = typeof startTime === "string" && !!startTime && typeof endTime === "string" && !!endTime;
    if (!volunteerAbsenceDay(startDate) || !volunteerAbsenceDay(endDate) || startDate > endDate || (!allDay && !timed)) {
      unsupported += 1;
      continue;
    }
    if (startDate > through || endDate < from) continue;
    const startUtc = utcClock(startTime);
    const endUtc = utcClock(endTime);
    dates.push({ sourceId: String(row.id), sourceStartDate: startDate, sourceEndDate: endDate, timed,
      ...(startUtc && endUtc && startUtc < endUtc ? { startUtc, endUtc } : {}) });
  }
  return { dates, unsupported };
}
