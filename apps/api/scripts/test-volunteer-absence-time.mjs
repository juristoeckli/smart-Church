import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hook = registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && specifier.endsWith(".js")) return next(specifier.slice(0, -3) + ".ts", context);
    throw error;
  }
} });
const { describeTimedVolunteerAbsence, parseTimedVolunteerAbsence, volunteerEventWindow } = await import("../src/volunteer-absence-time.ts");
hook.deregister();

const zone = "Europe/Zurich";
assert.deepEqual(parseTimedVolunteerAbsence("2026-10-25T02:30", "2026-10-25T03:30", zone), {
  startsAt: "2026-10-25T02:30:00", endsAt: "2026-10-25T03:30:00",
  startsOn: "2026-10-25", endsOn: "2026-10-25",
  startsAtUtc: "2026-10-25T01:30:00.000Z", endsAtUtc: "2026-10-25T02:30:00.000Z",
});
assert.equal(parseTimedVolunteerAbsence("2026-03-29T02:15", "2026-03-29T03:10", zone), null);
assert.equal(parseTimedVolunteerAbsence("2026-03-29T03:00", "2026-03-29T03:00", zone), null);
assert.equal(parseTimedVolunteerAbsence("2026-03-29T03:15Z", "2026-03-29T04:00", zone), null);
const overnight = parseTimedVolunteerAbsence("2026-03-28T23:00", "2026-03-29T00:00", zone);
assert.equal(overnight.endsOn, "2026-03-28");
assert.equal(describeTimedVolunteerAbsence(overnight.startsAtUtc, overnight.endsAtUtc, "Asia/Dubai").startsOn, "2026-03-29");
assert.deepEqual(volunteerEventWindow("2026-03-29", true, null, null, zone),
  { startsAtUtc: "2026-03-28T23:00:00.000Z", endsAtUtc: "2026-03-29T22:00:00.000Z" });
assert.deepEqual(volunteerEventWindow("2026-03-29", false, "09:00:00", null, zone),
  { startsAtUtc: "2026-03-29T07:00:00.000Z", endsAtUtc: null });
console.log("Timed volunteer absences honor site wall time, daylight saving and exclusive interval ends.");
