import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith("./") && specifier.endsWith(".js")) return next(specifier.slice(0, -3) + ".ts", context);
    throw error;
  }
} });
const { buildChurchToolsFinanceJournalDryRun, selectChurchToolsJournalRow, isTwoDecimalFinanceCurrency } = await import("../src/modules/churchtools-sync/finance-journal-dry-run.ts");
hooks.deregister();

const dates = { startDate: "2026-01-01", endDate: "2026-12-31" };
const account = (sourceId, id, code) => ({ sourceId, candidate: { id, code }, codeStatus: "active_code_match", typeReview: "asset_classification", sourceFlags: {} });
const input = {
  ...dates, sourceCurrency: "CHF", targetCurrency: "CHF", targetAvailable: true, existingDocumentNumbers: new Set(["Local receipt"]),
  sourcePeriod: { ...dates, fullPeriodAccess: true, closed: false }, localPeriod: { ...dates, year: 2026, status: "open" },
  mapping: { accounts: [account("1", "a", "001"), account("2", "b", "002"), { ...account("3", "d", "003"), sourceFlags: { donation: true } }],
    costCenters: [{ sourceId: "4", codeStatus: "active_code_match", candidate: { id: "c", code: "004" } }] },
  links: [{ kind: "account", source_id: "1", target_id: "a" }, { kind: "account", source_id: "2", target_id: "b" },
    { kind: "account", source_id: "3", target_id: "d" }, { kind: "cost_center", source_id: "4", target_id: "c" }],
};
const base = { documentDate: "2026-04-19", accountId: 1, contraAccountId: 2, isImmutable: false,
  amount: 7_200, note: "excluded note", bills: ["excluded attachment"] };
const raw = (id, extra = {}) => ({ ...base, id, documentNumber: "Document " + id, ...extra });
const rows = [
  raw(1), raw(2, { amount: -800 }), raw(3, { costCenterId: 4 }), raw(4, { costCenterId: 5 }),
  raw(5, { documentNumber: "Local receipt" }), raw(6, { documentNumber: "Same receipt" }),
  raw(7, { documentNumber: " Same   receipt " }), raw(8, { taxBaseId: 6, stornoTransactionId: 7, splitTransactionId: 7 }),
  raw(9, { donator: { title: "excluded donor" } }), raw(10, { accountId: 3 }),
  raw(11, { contraAccountId: 1, costCenterId: 4, contraCostCenterId: 6 }),
].map(selectChurchToolsJournalRow);
const reviewed = buildChurchToolsFinanceJournalDryRun(rows, input);
assert.deepEqual([reviewed.candidates, reviewed.candidateDebitMinor, reviewed.candidateCreditMinor], [1, "7200", "7200"]);
assert.deepEqual(reviewed.rows[0].sourceLines, [{ accountId: "1", debitMinor: "7200", creditMinor: "0" }, { accountId: "2", debitMinor: "0", creditMinor: "7200" }]);
assert.deepEqual(reviewed.rows[0].proposedTargetLines, [
  { accountId: "a", accountCode: "001", costCenterId: null, debitMinor: "7200", creditMinor: "0" },
  { accountId: "b", accountCode: "002", costCenterId: null, debitMinor: "0", creditMinor: "7200" },
]);
assert.deepEqual([reviewed.rows[1].signedMinor, reviewed.rows[1].proposedTargetLines.length], ["-800", 0]);
assert.deepEqual(reviewed.rows[2].reasons, ["cost_center_allocation_review"]);
assert.equal(reviewed.rows[2].proposedTargetLines[1].costCenterId, "c");
assert.deepEqual(reviewed.rows[3].reasons, ["unresolved_cost_center_link"]);
assert.deepEqual(reviewed.rows[4].reasons, ["duplicate_local_document"]);
assert.deepEqual(reviewed.rows[5].reasons, ["duplicate_source_document"]);
assert.deepEqual(reviewed.rows[6].reasons, ["duplicate_source_document"]);
assert.deepEqual(reviewed.rows[7].reasons, ["source_split", "source_tax", "source_cancellation"]);
assert.deepEqual(reviewed.rows[8].reasons, ["source_donation"]);
assert.deepEqual(reviewed.rows[9].reasons, ["source_account_configuration_review"]);
assert.equal(reviewed.rows[10].sourceContraCostCenterId, "6");
assert.equal(reviewed.rows[10].proposedTargetLines.length, 0);
assert.doesNotMatch(JSON.stringify(reviewed), /excluded/);
assert.deepEqual(buildChurchToolsFinanceJournalDryRun(rows, { ...input, targetCurrency: "EUR", localPeriod: { ...input.localPeriod, status: "closed" } }).blockedBy, ["closed_local_period", "currency_mismatch"]);
assert.deepEqual(buildChurchToolsFinanceJournalDryRun(rows, { ...input, sourcePeriod: { ...input.sourcePeriod, fullPeriodAccess: false, closed: true } }).blockedBy, ["restricted_source_period", "closed_source_period"]);
assert.equal(buildChurchToolsFinanceJournalDryRun(rows, { ...input, links: [{ kind: "account", source_id: "1", target_id: "wrong" }] }).candidates, 0);
assert.equal(isTwoDecimalFinanceCurrency("CHF"), true);
assert.equal(isTwoDecimalFinanceCurrency("JPY"), false);
assert.equal(isTwoDecimalFinanceCurrency("ZZZ"), false);
console.log("ChurchTools journal balances, sign, classifications, duplicate and currency checks passed.");
