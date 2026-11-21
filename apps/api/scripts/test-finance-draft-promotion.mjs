import assert from "node:assert/strict";
import { draftReceiptNumbers, reviewChurchToolsDraft } from "../src/modules/finance/draft-promotion.ts";

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
const splitLines = [lines[0], { ...lines[1], credit_cents: "1000" },
  { ...lines[1], id: "third", line_number: 3, account_id: "second-income", account_code: "300", credit_cents: "234" }];
const splitSource = { ...source, sourceId: "split:8", split: { parentId: "8", documentNumber: "receipt", date: header.bookingDate,
  children: [
    { sourceId: "21", documentNumber: "receipt/1", signedMinor: "1000", sourceDebitAccountId: "10", sourceCreditAccountId: "11" },
    { sourceId: "22", documentNumber: "receipt/2", signedMinor: "234", sourceDebitAccountId: "10", sourceCreditAccountId: "12" },
  ],
  accountLinks: [{ sourceId: "10", targetId: "bank" }, { sourceId: "11", targetId: "income" }, { sourceId: "12", targetId: "second-income" }],
} };
const splitReview = review(header, splitLines, "CHF", splitSource);
assert.deepEqual([splitReview.debitMinor, splitReview.creditMinor], ["1234", "1234"]);
assert.deepEqual(draftReceiptNumbers(header, splitSource), ["receipt", "receipt/1", "receipt/2"]);
assert.equal(review({ ...header, receiptNumber: "other receipt" }, splitLines, "CHF", splitSource), null);
assert.equal(review(header, [splitLines[0], { ...splitLines[1], credit_cents: "234" }, { ...splitLines[2], credit_cents: "1000" }], "CHF", splitSource), null);
assert.equal(review(header, splitLines, "CHF", { ...splitSource, split: { ...splitSource.split, accountLinks: splitSource.split.accountLinks.slice(0, 2) } }), null);
assert.equal(review(header, splitLines, "CHF", { ...splitSource, split: { ...splitSource.split, children: [
  splitSource.split.children[0], { ...splitSource.split.children[1], sourceDebitAccountId: "11" },
] } }), null);
console.log("ChurchTools Finance draft promotion review, unchanged balance, scope and eligibility tests passed.");
