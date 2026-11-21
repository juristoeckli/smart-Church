import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && specifier.endsWith(".js")) return next(specifier.slice(0, -3) + ".ts", context);
    throw error;
  }
} });
const { validVolunteerAbsenceRange } = await import("../src/event-volunteer-absences.ts");
const { readChurchToolsAbsencePreview } = await import("../src/modules/churchtools-sync/absence-preview.ts");
hooks.deregister();

assert.equal(validVolunteerAbsenceRange({ startsOn: "2028-02-29", endsOn: "2028-02-29" }), true);
assert.equal(validVolunteerAbsenceRange({ startsOn: "2027-02-29", endsOn: "2027-03-01" }), false);
assert.equal(validVolunteerAbsenceRange({ startsOn: "2026-01-01", endsOn: "2027-01-01" }), true);
assert.equal(validVolunteerAbsenceRange({ startsOn: "2026-01-01", endsOn: "2027-01-02" }), false);
const base = { person: { domainType: "person", domainIdentifier: "9", title: "Private name" },
  startDate: "2026-03-29", endDate: "2026-03-29", startTime: null, endTime: null,
  absenceReason: { name: "Private reason" }, comment: "Private comment" };
const list = (data) => ({ data, meta: { count: data.length } });
const preview = readChurchToolsAbsencePreview(list([
  { ...base, id: 1 }, { ...base, id: 2, startTime: "08:00", endTime: "09:00" },
  { ...base, id: 3, startDate: "2026-03-30", endDate: "2026-03-30" }, { ...base, id: 4, startTime: "08:00" },
]), "9", "2026-03-29", "2026-03-29");
assert.deepEqual(preview, { dates: [
  { sourceId: "1", sourceStartDate: "2026-03-29", sourceEndDate: "2026-03-29", timed: false },
  { sourceId: "2", sourceStartDate: "2026-03-29", sourceEndDate: "2026-03-29", timed: true },
], unsupported: 1 });
assert.doesNotMatch(JSON.stringify(preview), /Private|08:00|09:00/);
assert.throws(() => readChurchToolsAbsencePreview(list([{ ...base, id: 1 }]), "8", "2026-03-29", "2026-03-29"), /mismatched/);
assert.throws(() => readChurchToolsAbsencePreview(list([{ ...base, id: 1 }, { ...base, id: 1 }]), "9", "2026-03-29", "2026-03-29"), /duplicate/);
console.log("Volunteer absence validates calendar ranges and redacts ChurchTools person details and reasons.");
