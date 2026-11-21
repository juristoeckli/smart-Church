import { volunteerAbsenceDay } from "../../event-volunteer-absences.js";

const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function readChurchToolsAbsencePreview(payload: unknown, personId: string, from: string, through: string) {
  const root = object(payload);
  const records = root?.data;
  if (!Array.isArray(records) || records.length > 250 || object(root?.meta)?.count !== records.length) {
    throw new Error("ChurchTools must return a complete list of up to 250 visible absences. Choose a narrower range.");
  }
  const seen = new Set<number>();
  const dates: Array<{ sourceId: string; sourceStartDate: string; sourceEndDate: string; timed: boolean }> = [];
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
    if (startDate <= through && endDate >= from) dates.push({ sourceId: String(row.id), sourceStartDate: startDate, sourceEndDate: endDate, timed });
  }
  return { dates, unsupported };
}
