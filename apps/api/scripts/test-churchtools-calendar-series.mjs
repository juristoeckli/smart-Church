import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && specifier.endsWith(".js")) return next(specifier.slice(0, -3) + ".ts", context);
    throw error;
  }
} });
const { reviewChurchToolsCalendarSeries } = await import("../src/modules/churchtools-sync/calendar-series.ts");
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
assert.throws(() => review({ appointment: { ...appointment, allDay: true } }), /timed series/);
assert.throws(() => review({ calculatedDates: { "2026-02-30": occurrence("2026-02-30", 8) } }), /invalid occurrence/);
assert.throws(() => review({ calculatedDates: { "2026-10-25": occurrence("2026-10-25", 0) } }), /represented exactly/);
assert.throws(() => review({ calculatedDates: { ...dates, "2026-04-13": occurrence("2026-04-13", 8) } }), /times vary/);
console.log("ChurchTools recurring calendar import review handles exact DST, exceptions, extra dates and source changes.");
