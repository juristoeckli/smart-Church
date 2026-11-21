import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && specifier.endsWith(".js")) return next(specifier.slice(0, -3) + ".ts", context);
    throw error;
  }
} });
const { readChurchToolsAllDaySeriesDates, reviewChurchToolsCalendarSeries } = await import("../src/modules/churchtools-sync/calendar-series.ts");
hooks.deregister();

const occurrence = (day, hour, event) => ({ startDate: `${day}T0${hour}:15:00Z`, endDate: `${day}T0${hour}:55:00Z`, event });
const appointment = { id: 7, calendar: { id: 2 }, repeatId: 7, allDay: false, title: "Sunday service",
  exceptions: [{ date: "2026-04-05" }], additionals: [{ date: "2026-04-06", isRepeated: false }] };
const dates = {
  "2026-03-22": occurrence("2026-03-22", 8, { id: 20 }),
  "2026-03-29": occurrence("2026-03-29", 7),
  "2026-04-06": occurrence("2026-04-06", 7, { id: 30 }),
};
const fixture = (overrides = {}) => ({ data: { appointment, calculatedDates: dates, ...overrides } });
const review = (overrides) => reviewChurchToolsCalendarSeries(fixture(overrides), "2", "7", "Europe/Zurich");
const result = review();
assert.deepEqual(result.recurrence, { frequency: "manual", interval: 1, endsOn: "2026-04-06", dates: Object.keys(dates) });
assert.deepEqual(result.dates.map(({ startsAt }) => startsAt.slice(11)), ["09:15:00", "09:15:00", "09:15:00"]);
assert.deepEqual(result.dates.map(({ eventId }) => eventId), ["20", null, "30"]);
assert.equal(review({ calculatedDates: Object.fromEntries(Object.entries(dates).reverse()) }).sourceHash, result.sourceHash);
assert.notEqual(review({ appointment: { ...appointment, title: "New title" } }).sourceHash, result.sourceHash);
assert.throws(() => review({ appointment: { ...appointment, id: 8 } }), /different appointment/);
assert.throws(() => review({ appointment: { ...appointment, allDay: true } }), /verified inclusive end/);
assert.throws(() => review({ calculatedDates: { "2026-02-30": occurrence("2026-02-30", 8) } }), /invalid occurrence date/);
assert.throws(() => review({ calculatedDates: { "2026-10-25": occurrence("2026-10-25", 0) } }), /represented exactly/);
const variable = review({ calculatedDates: { ...dates, "2026-04-13": occurrence("2026-04-13", 8) } });
assert.deepEqual(variable.recurrence.dates, Object.keys(dates));
assert.deepEqual(variable.extraDates, [{ startsAt: "2026-04-13T10:15:00", endsAt: "2026-04-13T10:55:00" }]);

const allDayAppointment = { ...appointment, allDay: true, version: 3 };
const allDaySource = fixture({ appointment: allDayAppointment });
const occurrenceDetail = (day, version = 3) => ({ data: { appointment: {
  base: { ...allDayAppointment, version },
  calculated: { startDate: day, endDate: day === "2026-04-06" ? "2026-04-08" : day },
} } });
const inclusiveEnds = await readChurchToolsAllDaySeriesDates(allDaySource, "2", "7", async (day) => occurrenceDetail(day));
const allDayReview = reviewChurchToolsCalendarSeries(allDaySource, "2", "7", "Europe/Zurich", inclusiveEnds);
assert.equal(allDayReview.allDay, true);
assert.equal(allDayReview.dates[0].endsAt, "2026-03-22T23:59:59");
assert.deepEqual(allDayReview.recurrence.dates, ["2026-03-22", "2026-03-29"]);
assert.equal(allDayReview.recurrence.endsOn, "2026-04-08");
assert.deepEqual(allDayReview.extraDates, [{ startsAt: "2026-04-06T00:00:00", endsAt: "2026-04-08T23:59:59" }]);
await assert.rejects(readChurchToolsAllDaySeriesDates(allDaySource, "2", "7", async (day) => occurrenceDetail(day, 4)), /series changed/);
console.log("ChurchTools recurring calendar import handles exact DST, varying times, inclusive all-day intervals, and source changes.");
