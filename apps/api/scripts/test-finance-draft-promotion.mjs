import assert from "node:assert/strict";
import { reviewChurchToolsDraft } from "../src/modules/finance/draft-promotion.ts";

const header = { id: "draft", bookingDate: "2026-10-01", accountingYear: 2026, receiptNumber: "receipt", bookingText: "Imported draft", status: "draft", reversesTransactionId: null };
const line = { account_code: "100", account_name: "Bank", account_type: "asset", account_active: true, cost_center_id: null, donor_id: null, line_text: "" };
const lines = [
  { ...line, id: "debit", line_number: 1, account_id: "bank", debit_cents: "1234", credit_cents: "0" },
  { ...line, id: "credit", line_number: 2, account_id: "income", account_code: "200", debit_cents: "0", credit_cents: "1234" },
];
const source = { instanceUrl: "https://fixture.church.tools", periodId: "7", sourceId: "88" };
const review = (draft = header, rows = lines, currency = "CHF", provenance = source) => reviewChurchToolsDraft(draft, rows, currency, provenance);
const approved = review();
assert.deepEqual([approved.debitMinor, approved.creditMinor], ["1234", "1234"]);
assert.deepEqual(review(), approved);
assert.equal(review(header, lines.map((row) => ({ ...row, debit_cents: Number(row.debit_cents), credit_cents: Number(row.credit_cents) }))).reviewHash, approved.reviewHash);
assert.notEqual(review({ ...header, bookingDate: "2026-10-02" }).reviewHash, approved.reviewHash);
assert.notEqual(review(header, [{ ...lines[0], account_name: "Renamed account" }, lines[1]]).reviewHash, approved.reviewHash);
assert.notEqual(review(header, lines, "EUR").reviewHash, approved.reviewHash);
assert.notEqual(review(header, lines, "CHF", { ...source, sourceId: "89" }).reviewHash, approved.reviewHash);
assert.equal(review({ ...header, status: "posted" }), null);
assert.equal(review(header, [...lines, lines[1]]), null);
assert.equal(review(header, [lines[0], { ...lines[1], credit_cents: "1235" }]), null);
assert.equal(review(header, [lines[0], { ...lines[1], account_active: false }]), null);
assert.equal(review(header, [lines[0], { ...lines[1], donor_id: "other" }]), null);
assert.equal(review(header, [lines[0], { ...lines[1], cost_center_id: "other" }]), null);
assert.equal(review(header, [lines[0], { ...lines[1], account_id: "bank" }]), null);
assert.equal(review(header, [{ ...lines[0], debit_cents: "9000000000000001" }, { ...lines[1], credit_cents: "9000000000000001" }]), null);
console.log("ChurchTools Finance draft promotion review, unchanged balance, scope and eligibility tests passed.");
