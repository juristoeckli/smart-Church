import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith("./") && specifier.endsWith(".js")) return next(specifier.slice(0, -3) + ".ts", context);
    throw error;
  }
} });
const { readChurchToolsSplitGroup, reconcileChurchToolsSplitGroup, planReviewedSplitDrafts } = await import("../src/modules/churchtools-sync/finance-split-review.ts");
const { selectChurchToolsJournalRow } = await import("../src/modules/churchtools-sync/finance-journal-dry-run.ts");
hooks.deregister();
const scope = { startDate: "2026-10-01", endDate: "2026-10-31" };
const child = (id, credit, amount, values = {}) => ({ id, accountId: 11, contraAccountId: credit, amount, splitTransactionId: 5,
  documentNumber: `R/${id}`, documentDate: "2026-10-07", isImmutable: false, note: "hidden note", ...values });
const raw = [child(21, 12, 1200), child(22, 13, 800)];
const payload = (children = raw, total = 2000) => ({ data: { id: 5, amount: total, documentDate: "2026-10-07",
  documentNumber: "R", splitChildren: children, note: "hidden parent" } });
const account = (sourceId, id, code) => ({ sourceId, candidate: { id, code }, codeStatus: "active_code_match", typeReview: "asset_classification", sourceFlags: {} });
const mapping = { accounts: [account("11", "a", "01"), account("12", "b", "02"), account("13", "c", "03")], costCenters: [] };
const links = [{ kind: "account", source_id: "11", target_id: "a" }, { kind: "account", source_id: "12", target_id: "b" }, { kind: "account", source_id: "13", target_id: "c" }];
const preview = (entry = payload(), journal = raw, blockers = [], localDuplicate = false) =>
  reconcileChurchToolsSplitGroup(readChurchToolsSplitGroup(entry, "5", scope), journal.map(selectChurchToolsJournalRow), mapping, links, blockers, localDuplicate);
const ordinary = preview();
assert.equal(ordinary.sharedSide, "debit");
assert.deepEqual([ordinary.parentSignedMinor, ordinary.childSignedTotalMinor], ["2000", "2000"]);
assert.deepEqual(ordinary.proposedTargetLines, [
  { accountId: "a", accountCode: "01", debitMinor: "2000", creditMinor: "0" },
  { accountId: "b", accountCode: "02", debitMinor: "0", creditMinor: "1200" },
  { accountId: "c", accountCode: "03", debitMinor: "0", creditMinor: "800" },
]);
assert.doesNotMatch(JSON.stringify(ordinary), /hidden/);
assert.deepEqual(preview(payload(raw, 2001)).reasons, ["parent_child_total_mismatch"]);
assert.equal(preview(payload(), [raw[0]]).proposedTargetLines.length, 0);
assert.ok(preview(payload(), [raw[0]]).reasons.includes("journal_children_unconfirmed"));
assert.deepEqual(preview(payload(), raw, [], true).reasons, ["duplicate_local_document"]);
assert.equal(preview(payload(), raw, ["closed_local_period"]).proposedTargetLines.length, 0);
const generated = child(24, 13, 100, { taxBaseId: 22, splitTransactionId: null });
const withTax = preview(payload([...raw, generated], 2100), [...raw, generated]);
assert.equal(withTax.childSignedTotalMinor, "2100");
assert.equal(withTax.children[2].generatedTaxBaseId, "22");
assert.deepEqual(withTax.reasons, ["split_children_need_review"]);
const signed = [raw[0], child(22, 13, -100)];
assert.equal(preview(payload(signed, 1100), signed).children[1].signedMinor, "-100");
assert.ok(preview(payload(signed, 1100), signed).reasons.includes("nonpositive_or_unsupported_amount"));
assert.equal(readChurchToolsSplitGroup(payload([raw[0], { ...raw[1], documentDate: "2026-11-01" }]), "5", scope), null);
assert.throws(() => readChurchToolsSplitGroup(payload([raw[0], raw[0]]), "5", scope), /repeated/);
assert.throws(() => readChurchToolsSplitGroup(payload(), "6", scope), /invalid/);
const approved = { targetYear: 2026, blockedBy: [], groups: [{ parentId: "5", state: "available", review: ordinary }] };
const draft = planReviewedSplitDrafts(approved, ["5"]);
assert.equal(draft.rows[0].sourceId, "split:5");
assert.deepEqual(draft.rows[0].split.children.map(({ sourceId, signedMinor }) => [sourceId, signedMinor]), [["21", "1200"], ["22", "800"]]);
assert.throws(() => planReviewedSplitDrafts(approved, ["5", "5"]), /only once/);
assert.throws(() => planReviewedSplitDrafts({ ...approved, blockedBy: ["closed_local_period"] }, ["5"]), /period or currency/);
assert.throws(() => planReviewedSplitDrafts({ ...approved, groups: [{ parentId: "5", state: "available", review: withTax }] }, ["5"]), /already imported/);
assert.throws(() => planReviewedSplitDrafts({ ...approved, groups: [{ parentId: "5", state: "available", review: {
  ...ordinary, proposedTargetLines: ordinary.proposedTargetLines.slice(1),
} }] }, ["5"]), /balanced/);
console.log("ChurchTools split parent, signed grouping, generated tax and balanced local proposal tests passed.");
