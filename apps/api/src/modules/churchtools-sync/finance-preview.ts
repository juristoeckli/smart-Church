type SourceObject = Record<string, unknown>;
const object = (value: unknown): SourceObject | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as SourceObject : undefined;
export const financeSourceId = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : null;

export function financeDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function financeRows(payload: unknown, label: string) {
  const result = object(payload);
  if (!Array.isArray(result?.data) || object(result.meta)?.count !== result.data.length) throw new Error(`ChurchTools returned an incomplete finance ${label} list.`);
  return result.data;
}

export function isChurchToolsMappingCodeSupported(code: string) {
  return Boolean(code.trim()) && code.length <= 32 && code === code.trim().replace(/\s+/g, " ") && !/[\u0000-\u001f\u007f]/.test(code);
}

export function readChurchToolsFinancePeriods(periodsPayload: unknown, clientsPayload: unknown) {
  const clients = new Map<string, string>();
  for (const value of financeRows(clientsPayload, "client")) {
    const client = object(value);
    const id = financeSourceId(client?.id);
    if (!id || clients.has(id) || typeof client?.name !== "string" || !client.name.trim()) throw new Error("ChurchTools returned an invalid or duplicate finance client.");
    clients.set(id, client.name.trim().slice(0, 200));
  }
  const periods = new Set<string>();
  return financeRows(periodsPayload, "accounting period").map((value) => {
    const period = object(value);
    const periodId = financeSourceId(period?.id);
    const clientId = financeSourceId(period?.clientId);
    if (!periodId || periods.has(periodId) || !clientId || !financeDay(period?.startDate) || !financeDay(period?.endDate)
      || period.endDate < period.startDate || typeof period.isClosed !== "boolean") {
      throw new Error("ChurchTools returned an invalid or duplicate accounting period.");
    }
    periods.add(periodId);
    const permissions = object(period.permissions);
    return {
      periodId, clientId, clientName: clients.get(clientId) ?? null,
      startDate: period.startDate, endDate: period.endDate, closed: period.isClosed,
      fullPeriodAccess: permissions?.["view accounting period"] === true || permissions?.["edit accounting period"] === true,
    };
  }).sort((first, second) => second.startDate.localeCompare(first.startDate));
}

export function readChurchToolsFinanceCodes(payload: unknown, periodId: string, label: "account" | "cost center") {
  const codes = new Map<string, string>();
  for (const value of financeRows(payload, label)) {
    const record = object(value);
    const id = financeSourceId(record?.id);
    if (!id || codes.has(id) || financeSourceId(record?.accountingPeriodId) !== periodId || typeof record?.number !== "string") {
      throw new Error(`ChurchTools returned an invalid or duplicate finance ${label}.`);
    }
    codes.set(id, record.number);
  }
  return codes;
}

export function compareChurchToolsFinanceCodes(source: ReadonlyMap<string, string>, target: { code: string; active: boolean }[]) {
  const targetCodes = new Map(target.map((row) => [row.code, row.active]));
  const sourceCounts = new Map<string, number>();
  for (const code of source.values()) sourceCounts.set(code, (sourceCounts.get(code) ?? 0) + 1);
  const summary = { activeMatches: 0, inactiveMatches: 0, unmatched: 0, ambiguous: 0, unsupported: 0 };
  for (const code of source.values()) {
    if (!isChurchToolsMappingCodeSupported(code)) summary.unsupported += 1;
    else if ((sourceCounts.get(code) ?? 0) > 1) summary.ambiguous += 1;
    else if (!targetCodes.has(code)) summary.unmatched += 1;
    else if (targetCodes.get(code)) summary.activeMatches += 1;
    else summary.inactiveMatches += 1;
  }
  return summary;
}

export class ChurchToolsFinanceRangeError extends Error {}

export async function readChurchToolsFinanceJournal(
  readPage: (page: number, limit: number) => Promise<unknown>,
  accounts: ReadonlyMap<string, string>, costCenters: ReadonlyMap<string, string>,
  startDate: string, endDate: string,
) {
  const limit = 200;
  const maxPages = 50;
  const seen = new Set<string>();
  const splitParents = new Set<string>();
  const result = { visible: 0, splitChildren: 0, splitParents: 0, taxLinked: 0, cancellationLinked: 0, immutable: 0,
    costCenterTransfers: 0, waivers: 0, unsupportedAmounts: 0, unresolvedAccountRows: 0, unresolvedCostCenterRows: 0 };
  let expectedLastPage: number | undefined;
  let expectedTotal: number | undefined;
  for (let page = 1; page <= maxPages; page += 1) {
    const payload = object(await readPage(page, limit));
    const meta = object(payload?.meta);
    const pagination = object(meta?.pagination);
    const total = pagination?.total;
    const lastPage = pagination?.lastPage;
    if (!Array.isArray(payload?.data) || payload.data.length > limit || (meta?.count !== undefined && meta.count !== payload.data.length)
      || pagination?.current !== page || typeof lastPage !== "number" || !Number.isSafeInteger(lastPage) || lastPage < 0
      || (lastPage < page && !(page === 1 && lastPage === 0 && payload.data.length === 0))
      || (payload.data.length === 0 && page < lastPage && lastPage <= maxPages)
      || (expectedLastPage !== undefined && lastPage !== expectedLastPage)
      || (total !== undefined && (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0))
      || (expectedTotal !== undefined && total !== expectedTotal)) throw new Error("ChurchTools returned inconsistent finance journal pagination.");
    if (lastPage > maxPages || (typeof total === "number" && total > limit * maxPages)) {
      throw new ChurchToolsFinanceRangeError("The selected range contains more than 10,000 visible journal rows. Choose a narrower date range.");
    }
    expectedLastPage = lastPage;
    expectedTotal = typeof total === "number" ? total : undefined;
    for (const value of payload.data) {
      const row = object(value);
      const id = financeSourceId(row?.id);
      if (!row || !id || seen.has(id) || !financeDay(row.documentDate) || row.documentDate < startDate || row.documentDate > endDate) {
        throw new Error("ChurchTools returned an invalid, duplicate, or out-of-range journal row. Run a fresh preview.");
      }
      seen.add(id);
      result.visible += 1;
      const account = financeSourceId(row.accountId);
      const contraAccount = financeSourceId(row.contraAccountId);
      const parent = financeSourceId(row.splitTransactionId);
      if (parent) { splitParents.add(parent); result.splitChildren += 1; }
      if (financeSourceId(row.taxBaseId) || financeSourceId(row.taxTransactionId) || financeSourceId(row.taxRateId)) result.taxLinked += 1;
      if (financeSourceId(row.stornoBaseId) || financeSourceId(row.stornoTransactionId)) result.cancellationLinked += 1;
      if (row.isImmutable === true) result.immutable += 1;
      if (account && account === contraAccount && financeSourceId(row.contraCostCenterId)) result.costCenterTransfers += 1;
      if (row.isWaiverOfReimbursementOfExpenses === true) result.waivers += 1;
      if (typeof row.amount !== "number" || !Number.isSafeInteger(row.amount) || row.amount <= 0) result.unsupportedAmounts += 1;
      if (!account || !contraAccount || !accounts.has(account) || !accounts.has(contraAccount)) result.unresolvedAccountRows += 1;
      if ([row.costCenterId, row.contraCostCenterId].some((value) => value !== null && value !== undefined && !costCenters.has(financeSourceId(value) ?? ""))) {
        result.unresolvedCostCenterRows += 1;
      }
    }
    if (page >= lastPage) {
      if (expectedTotal !== undefined && expectedTotal !== result.visible) throw new Error("ChurchTools returned an incomplete finance journal list.");
      result.splitParents = splitParents.size;
      return result;
    }
  }
  throw new Error("ChurchTools returned an incomplete finance journal list.");
}
