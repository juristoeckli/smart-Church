import assert from "node:assert/strict";
import { parsePeopleNumber, validPeopleNumber } from "../src/modules/people-records/number-field.ts";
import { normalizeMultilineField } from "../src/modules/people-records/multiline-field.ts";
import { normalizePeopleLocalDateTime } from "../src/modules/people-records/local-datetime.ts";
import { parsePeopleChoices, validPeopleChoices } from "../src/modules/people-records/multiselect-field.ts";

assert.equal(parsePeopleNumber(" -12.75 "), -12.75);
assert.equal(parsePeopleNumber("+2.5e2"), 250);
assert.equal(parsePeopleNumber(".05"), 0.05);
assert.equal(parsePeopleNumber("0.000"), 0);
assert.equal(parsePeopleNumber("9007199254740991"), Number.MAX_SAFE_INTEGER);
assert.ok(validPeopleNumber(-Number.MAX_SAFE_INTEGER));
assert.ok(!validPeopleNumber("12.75"));
assert.ok(!validPeopleNumber(Infinity));
assert.ok(!validPeopleNumber(NaN));

for (const raw of ["", "0x10", "1,25", "1.2.3", "1e500", "1e-500", "9007199254740992"]) {
  assert.equal(parsePeopleNumber(raw), undefined, `Invalid numeric text accepted: ${raw}`);
}
assert.equal(parsePeopleNumber("12.75", 4), undefined);
assert.equal(parsePeopleNumber("2e3", 3), undefined);
assert.equal(parsePeopleNumber("2e3", 4), 2000);
assert.ok(!validPeopleNumber(12.75, 4));

assert.equal(normalizeMultilineField(" line one\r\nline two\rline three "), " line one\nline two\nline three ");
assert.equal(normalizeMultilineField("\nkept\n\n"), "\nkept\n\n");
assert.equal(normalizeMultilineField(""), "");

assert.equal(normalizePeopleLocalDateTime("2024-02-29 08:15"), "2024-02-29T08:15:00");
assert.equal(normalizePeopleLocalDateTime("2026-03-29T02:30"), "2026-03-29T02:30:00");
assert.equal(normalizePeopleLocalDateTime("2026-10-25T02:30:45"), "2026-10-25T02:30:45");
for (const invalid of [null, "0000-01-01T00:00", "2025-02-29T08:15", "2026-01-02", "2026-01-02T24:00", "2026-01-02T08:15Z", "2026-01-02T08:15+01:00"]) {
  assert.equal(normalizePeopleLocalDateTime(invalid), null);
}

const allowedChoices = ["One", "Two, also", "Three"];
assert.deepEqual(parsePeopleChoices('["Two, also","One"]', allowedChoices), ["Two, also", "One"]);
assert.deepEqual(parsePeopleChoices("[]", allowedChoices), []);
assert.equal(parsePeopleChoices('["One","One"]', allowedChoices), null);
assert.equal(parsePeopleChoices('["Two"]', allowedChoices), null);
assert.equal(parsePeopleChoices('"One"', allowedChoices), null);
assert.equal(parsePeopleChoices("[1]", allowedChoices), null);
assert.equal(parsePeopleChoices("unquoted", allowedChoices), null);
const tooMany = Array.from({ length: 101 }, (_, index) => String(index));
assert.ok(!validPeopleChoices(tooMany, tooMany));

console.log("People custom field type regressions passed.");
