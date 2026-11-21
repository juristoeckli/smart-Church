import assert from "node:assert/strict";
import { membershipCsvRows, readCsvRows } from "../src/modules/people-records/csv-import.ts";

assert.deepEqual(membershipCsvRows('\uFEFFLast name,First name,Email address\r\n"O""Brien, Jr.",Pat,pat@example.test\r\n'), [
  { firstName: "Pat", lastName: 'O"Brien, Jr.', email: "pat@example.test" },
]);
assert.deepEqual(membershipCsvRows("First name,Last name\nPat,Smith"), [
  { firstName: "Pat", lastName: "Smith", email: "" },
]);
assert.throws(() => membershipCsvRows("First name,First-name,Last name\nPat,Ana,Smith"), /only one column/);
assert.throws(() => membershipCsvRows("First name,Last name,Email,Email address\nPat,Smith,one@example.test,two@example.test"), /only one column/);
assert.throws(() => membershipCsvRows('First name,Last name\nPat,"Smith'), /unclosed quotation mark/);
assert.throws(() => membershipCsvRows("First name,Last name\n" + "Pat,Smith\n".repeat(101)), /100 data rows/);
assert.deepEqual(readCsvRows('First name,Last name\nPat,"Smith'), [["First name", "Last name"], ["Pat", "Smith"]]);

console.log("Membership CSV validates unique match columns without changing the profile parser.");
