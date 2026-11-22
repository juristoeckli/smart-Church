import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && (specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".js")) return next(specifier.slice(0, -3) + ".ts", context);
    throw error;
  }
} });
const { planReviewedJournalDrafts, journalDraftBatchId } = await import("../src/modules/churchtools-sync/finance-journal-drafts.ts");
hooks.deregister();

const scope = { startDate: "2026-01-01", endDate: "2026-12-31", sourceCurrency: "CHF" };
const debit = { accountId: "debit", costCenterId: null, debitMinor: "123", creditMinor: "0" };
const credit = { accountId: "credit", costCenterId: null, debitMinor: "0", creditMinor: "123" };
const row = { sourceId: "1", date: "2026-10-12", documentNumber: "AB7", reasons: [], proposedTargetLines: [debit, credit] };
const preview = { targetYear: 2026, blockedBy: [], rows: [row] };
assert.equal(planReviewedJournalDrafts(preview, ["1"]).rows[0].debit.debitMinor, "123");
assert.throws(() => planReviewedJournalDrafts(preview, ["2"]), /review|imported/);
assert.throws(() => planReviewedJournalDrafts(preview, ["1", "1"]), /only once/);
assert.throws(() => planReviewedJournalDrafts({ ...preview, blockedBy: ["closed_local_period"] }, ["1"]), /period/);
for (const change of [
  { reasons: ["source_already_linked"] }, { reasons: ["cost_center_allocation_review"] },
  { proposedTargetLines: [debit, { ...credit, accountId: debit.accountId }] },
  { proposedTargetLines: [debit, { ...credit, creditMinor: "123.01" }] },
  { proposedTargetLines: [{ ...debit, costCenterId: "center" }, credit] },
]) assert.throws(() => planReviewedJournalDrafts({ ...preview, rows: [{ ...row, ...change }] }, ["1"]));
assert.equal(journalDraftBatchId("approved", ["1", "2"], scope), journalDraftBatchId("approved", ["2", "1"], scope));
assert.notEqual(journalDraftBatchId("approved", ["1"], scope), journalDraftBatchId("approved", ["1"], { ...scope, sourceCurrency: "EUR" }));
console.log("ChurchTools journal draft eligibility, exact balance and retry identity tests passed.");
