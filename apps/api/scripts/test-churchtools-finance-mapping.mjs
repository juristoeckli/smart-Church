import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith("./") && specifier.endsWith(".js")) return next(specifier.slice(0, -3) + ".ts", context);
    throw error;
  }
} });
const { buildChurchToolsFinanceMapping } = await import("../src/modules/churchtools-sync/finance-mapping.ts");
hooks.deregister();

const rows = (data) => ({ data, meta: { count: data.length } });
const account = (id, number, accountGroupId, extras = {}) => ({ id, accountingPeriodId: 7, number, name: "Account " + id, accountGroupId,
  annotation: "excluded memo", balance: 12345, ...extras });
const source = {
  accounts: rows([account(1, "001", 1), account(2, "01", 2), account(3, "02", 3), account(4, "03", 4), account(5, "04", 1, { isOpeningBalanceAccount: true }),
    account(6, "05", 1), account(7, "05", 1), account(8, "bad  code", 1)]),
  costCenters: rows([{ id: 1, number: "010", accountingPeriodId: 7, name: "Center", budget: 12345 }]),
  groups: rows([{ id: 1, name: "Bank", accountClassId: 1, isCashAssetAccount: true }, { id: 2, name: "Balance liabilities", accountClassId: 2 }, { id: 3, name: "Operating", accountClassId: 3 }]),
  classes: rows([{ id: 1, name: "Assets", accountTypeId: 1 }, { id: 2, name: "Liabilities", accountTypeId: 2 }, { id: 3, name: "Profit and loss", accountTypeId: 3 }]),
  types: rows([{ id: 1, name: "Assets", balanceType: "assets" }, { id: 2, name: "Liabilities side", balanceType: "liabilities" }, { id: 3, name: "Profit and loss", balanceType: null }]),
};
const local = {
  accounts: [
    { code: "001", name: "Local bank", active: true, accountType: "asset" },
    { code: "01", name: "Equity", active: true, accountType: "equity" },
    { code: "02", name: "Incorrect side", active: true, accountType: "asset" },
    { code: "05", name: "Inactive", active: false, accountType: "asset" },
  ],
  costCenters: [{ code: "010", name: "Local center", active: false }],
};
const mapping = buildChurchToolsFinanceMapping("7", source, local);
assert.deepEqual(mapping.accounts.map(({ codeStatus, typeReview }) => [codeStatus, typeReview]), [
  ["active_code_match", "asset_classification"], ["active_code_match", "manual_classification_required"], ["active_code_match", "incompatible_local_type"],
  ["no_local_match", "source_hierarchy_unresolved"], ["no_local_match", "special_account_review_required"],
  ["duplicate_source_code", "asset_classification"], ["duplicate_source_code", "asset_classification"], ["unsupported_code", "asset_classification"],
]);
assert.deepEqual(mapping.accounts[0].sourceHierarchy.group, { sourceId: "1", name: "Bank" });
assert.equal(mapping.accounts[0].sourceFlags.cashAsset, true);
assert.equal(mapping.accounts[1].sourceClassification, "liability_or_equity");
assert.equal(mapping.accounts[2].sourceClassification, "income_or_expense");
assert.equal(mapping.costCenters[0].codeStatus, "inactive_local_match");
assert.doesNotMatch(JSON.stringify(mapping), /excluded memo|12345/);
assert.deepEqual(buildChurchToolsFinanceMapping("7", { ...source, accounts: rows([...source.accounts.data].reverse()) }, local), mapping);
assert.equal(buildChurchToolsFinanceMapping("7", source, null).accounts[0].codeStatus, "local_finance_unavailable");
assert.throws(() => buildChurchToolsFinanceMapping("7", { ...source, types: rows([source.types.data[0], source.types.data[0]]) }, local), /duplicate/);
console.log("ChurchTools finance hierarchy and repeatable code mapping tests passed.");
