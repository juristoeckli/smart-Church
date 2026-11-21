import assert from "node:assert/strict";
import { fullDayBookingWindow } from "../src/modules/resource-scheduler/zoned-input.ts";

const spring = fullDayBookingWindow("2026-03-29", "Europe/Zurich");
assert.deepEqual(spring, {
  startsAt: "2026-03-28T23:00:00.000Z",
  endsAt: "2026-03-29T22:00:00.000Z",
});

const autumn = fullDayBookingWindow("2026-10-25", "Europe/Zurich");
assert.deepEqual(autumn, {
  startsAt: "2026-10-24T22:00:00.000Z",
  endsAt: "2026-10-25T23:00:00.000Z",
});

assert.deepEqual(fullDayBookingWindow("2026-12-31", "Asia/Kathmandu"), {
  startsAt: "2026-12-30T18:15:00.000Z",
  endsAt: "2026-12-31T18:15:00.000Z",
});

assert.throws(() => fullDayBookingWindow("2026-02-30", "UTC"), /valid booking date/);
assert.throws(() => fullDayBookingWindow("2011-12-30", "Pacific/Apia"), /resolve local time/);

console.log("Full-day resource windows cover local dates across clock and calendar changes.");
