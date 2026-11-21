import assert from "node:assert/strict";
import { normalizeChurchToolsBookingHistory } from "../src/modules/churchtools-sync/booking-history.ts";

const base = {
  id: 98, resourceId: 3, statusId: 3, quantity: 2, isAnonymized: false,
  allDay: false, title: "Band rehearsal", subtitle: "Setup", description: "Bring microphones",
  startDate: "2026-10-04T18:00:00+02:00", endDate: "2026-10-04T20:00:00+02:00",
  appointment: { id: 28, calendarId: 4 }, onBehalfOfPid: 14, answeredPid: 2,
  answeredDate: "2026-10-02T10:00:00Z", repeatId: 7, repeatFrequency: 1, repeatUntil: "2026-10-31",
  additionals: [{ id: 9, date: "2026-10-06", isRepeated: true, meta: { modifiedPid: 70 } }],
  exceptions: [{ id: 10, date: "2026-10-18" }],
  meta: { createdPerson: { id: 43 }, modifiedPerson: { id: 44 } },
};
const row = (details, startDate, endDate) => ({ booking: { base: details, calculated: { startDate, endDate } } });
const normalize = (...data) => normalizeChurchToolsBookingHistory([{ data, meta: { count: data.length } }], new Set(["3"]));
const first = row(base, base.startDate, base.endDate);
const equivalent = row(base, "2026-10-04T16:00:00Z", "2026-10-04T18:00:00Z");
const next = row(base, "2026-10-11T18:00:00+02:00", "2026-10-11T20:00:00+02:00");
const [recurring] = normalize(next, first, equivalent);
assert.equal(recurring.sourceId, "98");
assert.equal(recurring.occurrences.length, 2);
assert.deepEqual(recurring.occurrences[0], { startDate: base.startDate, endDate: base.endDate });
assert.equal(recurring.appointmentSourceId, "28");
assert.equal(recurring.createdBySourceId, "43");
assert.equal(recurring.statusId, 3);
assert.equal(recurring.recurrence.additionalDates[0].isRepeated, true);
assert.equal(recurring.recurrence.additionalDates[0].modifiedBySourceId, "70");
assert.equal(recurring.recurrence.excludedDates[0].date, "2026-10-18");

const [privateBooking] = normalize(row({ ...base, allDay: true, isAnonymized: true }, "2026-10-11", "2026-10-11"));
for (const key of ["title", "subtitle", "description", "appointmentSourceId", "calendarSourceId", "createdBySourceId",
  "modifiedBySourceId", "onBehalfOfSourceId", "answeredBySourceId"]) assert.equal(privateBooking[key], null);
assert.equal(privateBooking.recurrence.additionalDates[0].modifiedBySourceId, null);
assert.equal(privateBooking.occurrences[0].startDate, "2026-10-11");
assert.throws(() => normalize(first, row({ ...base, isAnonymized: true }, next.booking.calculated.startDate, next.booking.calculated.endDate)), /changed a booking/);
assert.throws(() => normalize(first, row(base, base.startDate, "2026-10-04T21:00:00+02:00")), /conflicting dates/);
assert.throws(() => normalize(row(base, "2026-02-31T12:00:00Z", "2026-03-04T12:00:00Z")), /invalid IDs or dates/);
assert.throws(() => normalizeChurchToolsBookingHistory([{ data: [], meta: { count: 1 } }], new Set(["3"])), /incomplete/);
assert.throws(() => normalizeChurchToolsBookingHistory([{ data: [first], meta: { count: 1 } }], new Set(["4"])), /invalid IDs or dates/);
assert.deepEqual(normalize(), []);
console.log("ChurchTools booking history normalization passed.");
