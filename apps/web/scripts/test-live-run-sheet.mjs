import assert from "node:assert/strict";
import { scheduledRunSheetProgress, timedRunSheet } from "../src/live-run-sheet-schedule.ts";

const overnight = timedRunSheet({
  startTime: "23:30",
  endTime: "00:30",
  timePlan: [
    { title: "Setup", startTime: "23:15", durationMinutes: 30 },
    { title: "Evening", startTime: "23:45", durationMinutes: 30 },
    { title: "After midnight", startTime: "00:10" },
    { title: "Untimed" },
  ],
});
assert.deepEqual(overnight.map(({ item, start, end }) => [item.title, start, end]), [
  ["Setup", 1395, 1425],
  ["Evening", 1425, 1450],
  ["After midnight", 1450, 1470],
]);
assert.equal(scheduledRunSheetProgress(overnight, 1445).current?.item.title, "Evening");
assert.equal(scheduledRunSheetProgress(overnight, 1445).next?.item.title, "After midnight");
assert.equal(scheduledRunSheetProgress(overnight, 1460).minutesLeft, 10);
assert.equal(scheduledRunSheetProgress(overnight, 1470).current, undefined);

const daytime = timedRunSheet({
  startTime: "09:00",
  endTime: "10:00",
  timePlan: [{ title: "First", startTime: "09:00" }, { title: "Second", startTime: "09:30" }],
});
assert.equal(scheduledRunSheetProgress(daytime, 570).current?.item.title, "Second");
assert.equal(scheduledRunSheetProgress(daytime, 590).minutesLeft, 10);
console.log("Scheduled run sheets follow the correct day boundary and item order.");
