import assert from "node:assert/strict";
import { formatLedgerCents } from "../src/modules/finance/ledger-cents.ts";

const options = { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 };
const dollars = new Intl.NumberFormat("en-US", options);
assert.equal(formatLedgerCents("9007199254742143", dollars), "$90,071,992,547,421.43");
assert.equal(formatLedgerCents("-9007199254742143", dollars), "-$90,071,992,547,421.43");
assert.equal(formatLedgerCents(-1, dollars), "-$0.01");
assert.equal(formatLedgerCents(0, dollars), "$0.00");

const euros = new Intl.NumberFormat("de-DE", { ...options, currency: "EUR" });
assert.equal(formatLedgerCents("9007199254742143", euros), "90.071.992.547.421,43\u00a0€");

console.log("Statement and turnover display preserve exact cents and locale formatting.");
