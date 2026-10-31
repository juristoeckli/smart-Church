import assert from "node:assert/strict";

const { parseChurchToolsEventDateTime } = await import("../src/modules/churchtools-sync/event-time.ts");

assert.deepEqual(parseChurchToolsEventDateTime("2026-01-15T10:00:00Z", undefined, undefined, "Europe/Zurich"), {
  date: "2026-01-15",
  time: "11:00",
});
assert.deepEqual(parseChurchToolsEventDateTime("2026-07-15T10:00:00Z", undefined, undefined, "Europe/Zurich"), {
  date: "2026-07-15",
  time: "12:00",
});
assert.deepEqual(parseChurchToolsEventDateTime("2026-01-15T10:00:00+01:00", undefined, undefined, "Europe/Zurich"), {
  date: "2026-01-15",
  time: "10:00",
});
assert.deepEqual(parseChurchToolsEventDateTime("2026-01-15T10:00:00", undefined, undefined, "Europe/Zurich"), {
  date: "2026-01-15",
  time: "10:00",
});
assert.deepEqual(parseChurchToolsEventDateTime("2026-01-15", undefined, "10:00", "Europe/Zurich"), {
  date: "2026-01-15",
  time: "10:00",
});

console.log("ChurchTools event time tests passed: UTC and offset timestamps convert to the location time zone, including daylight saving time.");
