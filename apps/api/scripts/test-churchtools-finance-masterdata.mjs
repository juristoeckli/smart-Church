import assert from "node:assert/strict";
import { financeBatchId, planChurchToolsFinanceMasterData } from "../src/modules/churchtools-sync/finance-masterdata.ts";

const common = { sourceId: "17", code: "0001", sourceName: "Source account", candidate: null, codeStatus: "no_local_match",
  sourceClassification: "liability_or_equity", sourceFlags: { openingBalance: false, taxRateConfigured: false, donation: false } };
const center = { sourceId: "9", code: "30", sourceName: "Cost center", candidate: null, codeStatus: "no_local_match" };
const accountSelection = { kind: "account", sourceId: "17", action: "create", accountType: "equity" };
const centerSelection = { kind: "cost_center", sourceId: "9", action: "create" };
const plan = (account, selections = [accountSelection]) => planChurchToolsFinanceMasterData({ accounts: [account], costCenters: [center] }, selections);
assert.equal(plan(common, [accountSelection, centerSelection]).length, 2);
assert.equal(plan(common, [accountSelection, centerSelection])[0].createName, "Source account");
assert.throws(() => plan(common, [{ ...accountSelection, accountType: undefined }]), /explicit/);
assert.throws(() => plan(common, [{ ...accountSelection, accountType: "expense" }]), /compatible/);
assert.throws(() => plan({ ...common, sourceClassification: "unresolved" }), /compatible/);
assert.throws(() => plan({ ...common, sourceFlags: { ...common.sourceFlags, taxRateConfigured: true } }), /locally configured/);
assert.throws(() => plan({ ...common, codeStatus: "duplicate_source_code" }), /mapping option/);
assert.throws(() => plan(common, [accountSelection, accountSelection]), /only once/);
assert.throws(() => plan(common, [{ ...centerSelection, accountType: "asset" }]), /Cost centers/);
assert.throws(() => plan({ ...common, sourceName: "x".repeat(161) }), /name requires review/);
const linked = { ...common, codeStatus: "active_code_match", candidate: { accountType: "liability" } };
assert.equal(plan(linked, [{ ...accountSelection, action: "link", accountType: "liability" }]).length, 1);
assert.throws(() => plan(linked, [{ ...accountSelection, action: "link", accountType: "equity" }]), /compatible/);
assert.equal(financeBatchId("proof", [accountSelection, centerSelection]), financeBatchId("proof", [centerSelection, accountSelection]));
assert.notEqual(financeBatchId("proof", [accountSelection]), financeBatchId("other", [accountSelection]));
console.log("ChurchTools Finance selection safety and deterministic retry tests passed.");
