import assert from "node:assert/strict";
import { parsePeopleNumber, validPeopleNumber } from "../src/modules/people-records/number-field.ts";
import { normalizeMultilineField } from "../src/modules/people-records/multiline-field.ts";

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

console.log("People custom field type regressions passed.");
