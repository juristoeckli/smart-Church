import assert from "node:assert/strict";
import {
  ChurchToolsFinanceRangeError, compareChurchToolsFinanceCodes, financeDay,
  readChurchToolsFinanceCodes, readChurchToolsFinanceJournal, readChurchToolsFinancePeriods,
} from "../src/modules/churchtools-sync/finance-preview.ts";

const unpaged = (...data) => ({ data, meta: { count: data.length } });
const periods = readChurchToolsFinancePeriods(
  unpaged({ id: 3, clientId: 7, startDate: "2026-01-01", endDate: "2026-12-31", isClosed: true, permissions: { "view accounting period": true } },
    { id: 4, clientId: 8, startDate: "2027-01-01", endDate: "2027-12-31", isClosed: false, permissions: {} }),
  unpaged({ id: 7, name: "Main", email: "excluded@example.org", datevClientNumber: "excluded identifier" }),
);
assert.deepEqual(periods[0], { periodId: "4", clientId: "8", clientName: null, startDate: "2027-01-01", endDate: "2027-12-31", closed: false, fullPeriodAccess: false });
assert.equal(periods[1].fullPeriodAccess, true);
assert.doesNotMatch(JSON.stringify(periods), /excluded/);
assert.equal(financeDay("2026-02-29"), false);
assert.equal(financeDay("2028-02-29"), true);
assert.throws(() => readChurchToolsFinancePeriods({ data: [], meta: { count: 1 } }, unpaged()), /incomplete/);
const sourceAccounts = readChurchToolsFinanceCodes(unpaged(
  { id: 1, accountingPeriodId: 3, number: "010" }, { id: 2, accountingPeriodId: 3, number: "10" }, { id: 3, accountingPeriodId: 3, number: "11" },
  { id: 4, accountingPeriodId: 3, number: "12" }, { id: 5, accountingPeriodId: 3, number: "12" }, { id: 6, accountingPeriodId: 3, number: " " },
), "3", "account");
assert.deepEqual(compareChurchToolsFinanceCodes(sourceAccounts, [{ code: "010", active: true }, { code: "10", active: false }, { code: "12", active: true }]), {
  activeMatches: 1, inactiveMatches: 1, unmatched: 1, ambiguous: 2, unsupported: 1,
});
assert.throws(() => readChurchToolsFinanceCodes(unpaged({ id: 1, accountingPeriodId: 9, number: "123" }), "3", "cost center"), /invalid/);
const costCenters = new Map([["1", "099"], ["2", "100"]]);
const page = (data, current, lastPage, total) => ({ data, meta: { all: 500, count: data.length, pagination: { current, lastPage, total } } });
const base = { id: 1, documentDate: "2026-10-01", amount: 2812, accountId: 1, contraAccountId: 2, donator: { title: "Excluded donor" }, note: "Excluded note" };
const journal = await readChurchToolsFinanceJournal(async (current, limit) => {
  assert.equal(limit, 200);
  return current === 1
    ? page([{ ...base, splitTransactionId: 21, taxTransactionId: 2, isImmutable: true }, { ...base, id: 2, splitTransactionId: 21, taxBaseId: 1, stornoTransactionId: 3 }], current, 2, 4)
    : page([{ ...base, id: 3, stornoBaseId: 2, contraAccountId: 90, costCenterId: 9, amount: -12 }, { ...base, id: 4, accountId: 1, contraAccountId: 1, costCenterId: 1, contraCostCenterId: 2, isWaiverOfReimbursementOfExpenses: true }], current, 2, 4);
}, sourceAccounts, costCenters, "2026-10-01", "2026-10-31");
assert.deepEqual(journal, { visible: 4, splitChildren: 2, splitParents: 1, taxLinked: 2, cancellationLinked: 2, immutable: 1,
  costCenterTransfers: 1, waivers: 1, unsupportedAmounts: 1, unresolvedAccountRows: 1, unresolvedCostCenterRows: 1 });
assert.doesNotMatch(JSON.stringify(journal), /Excluded|2812/);
const read = (reader) => readChurchToolsFinanceJournal(reader, sourceAccounts, costCenters, "2026-10-01", "2026-10-31");
assert.equal((await read(async () => page([], 1, 0, 0))).visible, 0);
await assert.rejects(read(async () => page([], 1, 51, 10_001)), ChurchToolsFinanceRangeError);
await assert.rejects(read(async (current) => page([base], current, 2, 2)), /duplicate/);
await assert.rejects(read(async () => page([base], 1, 1, 2)), /incomplete/);
await assert.rejects(read(async () => page([{ ...base, documentDate: "2026-11-01" }], 1, 1, 1)), /out-of-range/);
console.log("ChurchTools finance period, code matching, journal pagination and privacy tests passed.");
