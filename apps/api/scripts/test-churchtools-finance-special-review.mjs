import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith("./") && specifier.endsWith(".js")) return next(specifier.slice(0, -3) + ".ts", context);
    throw error;
  }
} });
const { selectChurchToolsJournalRow } = await import("../src/modules/churchtools-sync/finance-journal-dry-run.ts");
const { reconcileChurchToolsSpecialJournal } = await import("../src/modules/churchtools-sync/finance-special-review.ts");
const { reviewChurchToolsCancellationReadiness } = await import("../src/modules/churchtools-sync/finance-cancellation-readiness.ts");
hooks.deregister();

const fixture = (id, fields = {}) => selectChurchToolsJournalRow({
  id, documentDate: "2025-10-01", accountId: 30, contraAccountId: 40, amount: 100,
  note: "Private note", ...fields,
});
const rows = [
  fixture(1, { taxTransactionId: 2, taxRateId: 9, amount: 9_000_000_000_000_000 }),
  fixture(2, { taxBaseId: 1, amount: 9_000_000_000_000_000 }),
  fixture(3, { taxRateId: 9 }),
  fixture(4, { taxTransactionId: 6 }), fixture(5, { taxBaseId: 4 }), fixture(6, { taxBaseId: 4 }),
  fixture(7, { taxTransactionId: 700 }), fixture(8, { taxBaseId: 8 }),
  fixture(10, { stornoTransactionId: 11 }), fixture(11, { stornoBaseId: 10, accountId: 40, contraAccountId: 30 }),
  fixture(12, { stornoTransactionId: 13 }), fixture(13, { stornoBaseId: 12, amount: -100 }),
  fixture(14, { stornoTransactionId: 15 }), fixture(15, { stornoBaseId: 14 }),
  fixture(16, { stornoTransactionId: 17 }), fixture(17, { stornoBaseId: 16, costCenterId: 1, amount: -100 }),
  fixture(20, { stornoTransactionId: 21, taxRateId: 9 }), fixture(21, { stornoBaseId: 20, amount: -100 }),
  fixture(22, { stornoTransactionId: 23 }), fixture(23, { stornoBaseId: 22, amount: -100 }), fixture(24, { splitTransactionId: 22 }),
  fixture(25, { stornoTransactionId: 26 }), fixture(26, { stornoBaseId: 25, amount: -100, contraCostCenterId: "malformed" }),
  fixture(27, { stornoTransactionId: 28, donator: { name: "Private donor" } }), fixture(28, { stornoBaseId: 27, amount: -100 }),
];
const report = reconcileChurchToolsSpecialJournal(rows);
assert.equal(report.observedRows, rows.length);
assert.deepEqual(report.taxGroups.map(({ baseId, link, grossSignedMinor }) => [baseId, link, grossSignedMinor]), [
  ["1", "reciprocal", "18000000000000000"], ["20", "no_counterpart_reference", null], ["3", "no_counterpart_reference", null],
  ["4", "conflicting_references", null], ["4", "conflicting_references", null],
  ["7", "counterpart_not_visible_in_range", null], ["8", "self_reference", null],
]);
assert.equal(report.taxGroups.find((group) => group.baseId === "7").related, null);
assert.deepEqual(report.cancellations.map(({ comparison }) => comparison), [
  "exact_source_posting_inverse", "exact_source_posting_inverse", "source_posting_inverse_differs",
  "additional_postings_require_review", "additional_postings_require_review", "additional_postings_require_review",
  "additional_postings_require_review", "additional_postings_require_review",
]);
assert.doesNotMatch(JSON.stringify(report), /Private note|Private donor/);
assert.deepEqual(reconcileChurchToolsSpecialJournal([...rows].reverse()), report);

const pair = reconcileChurchToolsSpecialJournal([
  fixture(101, { documentNumber: "R101", stornoTransactionId: 102 }),
  fixture(102, { documentDate: "2025-11-01", documentNumber: "REV-R101", stornoBaseId: 101, amount: -100 }),
]).cancellations[0];
const scope = { departmentId: "department", instanceUrl: "source", periodId: "5", sourceCurrency: "CHF", fullPeriodAccess: true, targetWritable: true };
const original = { id: "local-101", date: "2025-10-01", year: 2025, receipt: "R101", status: "posted",
  reversesId: null, reversalId: null, reversalDate: null, trusted: true,
  lines: [{ accountId: "debit", debit: "100", credit: "0" }, { accountId: "credit", debit: "0", credit: "100" }] };
const local = { today: "2025-11-01", year: 2025, currency: "CHF", occupiedReceipts: new Set(),
  accounts: new Map([["30", "debit"], ["40", "credit"]]), originals: new Map([["101", original]]), linkedCancellations: new Set() };
assert.deepEqual(reviewChurchToolsCancellationReadiness(pair, scope, local).blockers, []);
assert.deepEqual(reviewChurchToolsCancellationReadiness(pair, scope, { ...local, today: "2025-11-02", year: null }).blockers,
  ["no_open_local_period_for_today", "native_reversal_uses_today"]);
assert.deepEqual(reviewChurchToolsCancellationReadiness(pair, scope, { ...local, occupiedReceipts: new Set(["REV-R101"]) }).blockers,
  ["native_reversal_receipt_in_use"]);
assert.deepEqual(reviewChurchToolsCancellationReadiness({ ...pair, base: null }, scope, local).localOriginal, null);
assert.deepEqual(reviewChurchToolsCancellationReadiness(pair, scope, { ...local, accounts: new Map() }).blockers,
  ["local_original_differs_from_source"]);
console.log("ChurchTools generated-tax and cancellation reconciliation tests passed.");
