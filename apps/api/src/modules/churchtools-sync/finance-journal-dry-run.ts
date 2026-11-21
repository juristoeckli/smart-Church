import type { buildChurchToolsFinanceMapping } from "./finance-mapping.js";
import { financeSourceId } from "./finance-preview.js";

type Mapping = ReturnType<typeof buildChurchToolsFinanceMapping>;
type Link = { kind: "account" | "cost_center"; source_id: string; target_id: string };
type LocalPeriod = { year: number; startDate: string; endDate: string; status: string };
type Input = {
  sourceCurrency: string;
  targetCurrency: string | null;
  startDate: string;
  endDate: string;
  sourcePeriod: { fullPeriodAccess: boolean; closed: boolean; startDate: string; endDate: string };
  localPeriod: LocalPeriod | null;
  targetAvailable: boolean;
  existingDocumentNumbers: ReadonlySet<string>;
  existingSourceIds?: ReadonlySet<string>;
  mapping: Mapping;
  links: Link[];
};
const currencyValues = new Set(Intl.supportedValuesOf("currency"));
const sourceId = financeSourceId;
const targetAmountLimit = 9_000_000_000_000_000;

export function isTwoDecimalFinanceCurrency(currency: string) {
  return currencyValues.has(currency) && new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits === 2;
}

export function selectChurchToolsJournalRow(raw: Readonly<Record<string, unknown>>) {
  const documentNumber = typeof raw.documentNumber === "string" && raw.documentNumber.length <= 80
    ? raw.documentNumber.trim().replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
  const debitAccountId = sourceId(raw.accountId);
  const creditAccountId = sourceId(raw.contraAccountId);
  const amount = typeof raw.amount === "number" && Number.isSafeInteger(raw.amount) ? raw.amount : null;
  const costCenterId = sourceId(raw.costCenterId);
  const contraCostCenterId = sourceId(raw.contraCostCenterId);
  const splitParentId = sourceId(raw.splitTransactionId);
  const taxBaseId = sourceId(raw.taxBaseId);
  const flags = {
    split: Boolean(splitParentId),
    tax: Boolean(taxBaseId || sourceId(raw.taxTransactionId) || sourceId(raw.taxRateId)),
    cancellation: Boolean(sourceId(raw.stornoBaseId) || sourceId(raw.stornoTransactionId)),
    transfer: Boolean((debitAccountId && debitAccountId === creditAccountId) || contraCostCenterId),
    immutable: raw.isImmutable !== false,
    discount: Boolean(sourceId(raw.cashDiscountId) || typeof raw.cashDiscountAmount === "number" && raw.cashDiscountAmount !== 0),
    donation: Boolean(sourceId(raw.donatorId) || sourceId(raw.donatorSpouseId) || raw.donator || raw.donatorSpouse || raw.isWaiverOfReimbursementOfExpenses === true),
    invalidCostCenter: raw.costCenterId !== null && raw.costCenterId !== undefined && !costCenterId,
  };
  return { sourceId: sourceId(raw.id)!, date: String(raw.documentDate), documentNumber, amount, debitAccountId, creditAccountId, costCenterId, contraCostCenterId, splitParentId, taxBaseId, flags };
}

type JournalRow = ReturnType<typeof selectChurchToolsJournalRow>;

export function buildChurchToolsFinanceJournalDryRun(rows: JournalRow[], input: Input) {
  const { sourcePeriod, localPeriod, startDate, endDate, sourceCurrency, targetCurrency } = input;
  const blockedBy: string[] = [];
  if (!sourcePeriod.fullPeriodAccess) blockedBy.push("restricted_source_period");
  if (sourcePeriod.closed) blockedBy.push("closed_source_period");
  if (!input.targetAvailable) blockedBy.push("local_finance_unavailable");
  else if (!localPeriod || localPeriod.startDate !== sourcePeriod.startDate || localPeriod.endDate !== sourcePeriod.endDate) blockedBy.push("no_exact_local_period");
  else if (localPeriod.status !== "open") blockedBy.push("closed_local_period");
  if (!targetCurrency || sourceCurrency !== targetCurrency || !isTwoDecimalFinanceCurrency(sourceCurrency)) blockedBy.push("currency_mismatch");
  const receiptCounts = new Map<string, number>();
  for (const row of rows) if (row.documentNumber) receiptCounts.set(row.documentNumber, (receiptCounts.get(row.documentNumber) ?? 0) + 1);
  const accounts = new Map(input.mapping.accounts.map((account) => [account.sourceId, account]));
  const centers = new Map(input.mapping.costCenters.map((center) => [center.sourceId, center]));
  const links = new Map(input.links.map((link) => [`${link.kind}:${link.source_id}`, link.target_id]));
  function specialAccount(id: string | null) {
    const account = id ? accounts.get(id) : undefined;
    return account?.sourceFlags.openingBalance || account?.sourceFlags.donation || account?.sourceFlags.taxRateConfigured;
  }
  function linkedAccount(id: string | null) {
    const source = id ? accounts.get(id) : undefined;
    const target = source?.codeStatus === "active_code_match" ? source.candidate : null;
    const durable = id ? links.get(`account:${id}`) : undefined;
    const compatible = source?.typeReview === "asset_classification" || source?.typeReview === "manual_classification_required";
    return target?.id && target.id === durable && compatible ? { id: target.id, code: target.code } : null;
  }
  function linkedCostCenter(id: string) {
    const source = centers.get(id);
    const target = source?.codeStatus === "active_code_match" ? source.candidate : null;
    return target?.id && target.id === links.get(`cost_center:${id}`) ? { id: target.id, code: target.code } : null;
  }
  let singleEntryVolume = 0n;
  let candidates = 0;
  const previews = rows.map((row) => {
    const reasons: string[] = [];
    if (!row.documentNumber) reasons.push("unsupported_document_number");
    if (row.documentNumber && (receiptCounts.get(row.documentNumber) ?? 0) > 1) reasons.push("duplicate_source_document");
    if (input.existingDocumentNumbers.has(row.documentNumber)) reasons.push("duplicate_local_document");
    if (input.existingSourceIds?.has(row.sourceId)) reasons.push("source_already_linked");
    if (row.amount === null || row.amount === 0 || Math.abs(row.amount) > targetAmountLimit) reasons.push("unsupported_amount");
    else if (row.amount < 0) reasons.push("negative_amount_review");
    for (const [flag, active] of Object.entries(row.flags)) if (active) reasons.push(`source_${flag}`);
    const debit = linkedAccount(row.debitAccountId);
    const credit = linkedAccount(row.creditAccountId);
    const center = row.costCenterId ? linkedCostCenter(row.costCenterId) : null;
    if (!debit || !credit || debit.id === credit.id) reasons.push("unresolved_account_link");
    if (specialAccount(row.debitAccountId) || specialAccount(row.creditAccountId)) reasons.push("source_account_configuration_review");
    if (row.costCenterId && !center) reasons.push("unresolved_cost_center_link");
    if (center) reasons.push("cost_center_allocation_review");
    const amount = row.amount !== null && row.amount > 0 && row.amount <= targetAmountLimit ? row.amount.toString() : null;
    const sourceLines = amount && row.debitAccountId && row.creditAccountId ? [
      { accountId: row.debitAccountId, debitMinor: amount, creditMinor: "0" },
      { accountId: row.creditAccountId, debitMinor: "0", creditMinor: amount },
    ] : [];
    const onlyAllocationReview = reasons.length === 1 && reasons[0] === "cost_center_allocation_review";
    const targetLines = !blockedBy.length && (!reasons.length || onlyAllocationReview) && amount && debit && credit ? [
      { accountId: debit.id, accountCode: debit.code, costCenterId: center?.id ?? null, debitMinor: amount, creditMinor: "0" },
      { accountId: credit.id, accountCode: credit.code, costCenterId: center?.id ?? null, debitMinor: "0", creditMinor: amount },
    ] : [];
    if (!blockedBy.length && !reasons.length && amount && targetLines.length) { candidates += 1; singleEntryVolume += BigInt(amount); }
    return {
      sourceId: row.sourceId, date: row.date, documentNumber: row.documentNumber || null,
      signedMinor: row.amount?.toString() ?? null, sourceCostCenterId: row.costCenterId, matchedCostCenterCode: center?.code ?? null,
      sourceContraCostCenterId: row.contraCostCenterId,
      splitParentId: row.splitParentId,
      reasons, sourceLines, proposedTargetLines: targetLines,
    };
  });
  return {
    startDate, endDate, sourceCurrency, targetCurrency, targetYear: localPeriod?.year ?? null, blockedBy,
    scanned: rows.length, candidates, candidateDebitMinor: singleEntryVolume.toString(), candidateCreditMinor: singleEntryVolume.toString(), rows: previews,
  };
}
