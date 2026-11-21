import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hook = registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && specifier.endsWith(".js")) return next(specifier.slice(0, -3) + ".ts", context);
    throw error;
  }
} });
const { planCalendarSeriesSplit, truncateCalendarSeries } = await import("../src/calendar-series-split.ts");
hook.deregister();

const manual = {
  starts_at: "2026-01-01T09:00:00", ends_at: "2026-01-01T10:00:00",
  recurrence: { frequency: "manual", dates: ["2026-01-01", "2026-01-08", "2026-01-22"], endsOn: "2026-02-01" },
};
const pivot = { startsAt: "2026-01-08T12:00:00", endsAt: "2026-01-08T13:30:00" };
const extra = { startsAt: "2026-01-15T11:00:00", endsAt: "2026-01-15T12:30:00" };
const plan = planCalendarSeriesSplit(manual, pivot.startsAt, pivot, manual.recurrence, [pivot, extra]);
assert.deepEqual(plan.previousRule.dates, ["2026-01-01", "2026-01-08"]);
assert.deepEqual(plan.futureRule.dates, ["2026-01-08"]);
assert.deepEqual(plan.retainedExtras, [extra]);
assert.deepEqual(plan.addedExtras, [{ startsAt: "2026-01-22T09:00:00", endsAt: "2026-01-22T10:00:00" }]);
assert.equal(plan.targetOccurrence("2026-01-22T09:00:00"), "2026-01-22T09:00:00");
assert.equal(plan.targetOccurrence("2026-01-22T12:00:00"), null);
const rekeyed = planCalendarSeriesSplit(manual, pivot.startsAt, { ...pivot, startsAt: "2026-01-08T12:30:00" }, manual.recurrence, [pivot, extra]);
assert.equal(rekeyed.targetOccurrence(pivot.startsAt), "2026-01-08T12:30:00");
assert.equal(planCalendarSeriesSplit(manual, pivot.startsAt, extra, manual.recurrence, [pivot, extra]), null);
assert.equal(planCalendarSeriesSplit(manual, "2026-01-09T09:00:00", pivot, manual.recurrence, [pivot]), null);

const counted = { ...manual, recurrence: { frequency: "weekly", count: 2 } };
assert.equal(truncateCalendarSeries(counted, pivot.startsAt).endsOn, "2026-01-08");
const exhausted = planCalendarSeriesSplit(counted, extra.startsAt, extra, counted.recurrence, [extra]);
assert.deepEqual(exhausted.futureRule, { frequency: "manual", endsOn: "2026-01-15", dates: ["2026-01-15"] });
console.log("Calendar series split partitions exact dates around the selected occurrence.");
