import { financeRows, financeSourceId, isChurchToolsMappingCodeSupported, readChurchToolsFinanceCodes } from "./finance-preview.js";

type RecordData = Record<string, unknown>;
type LocalCode = { code: string; name: string; active: boolean };
type LocalAccount = LocalCode & { accountType: "asset" | "liability" | "equity" | "income" | "expense" };
const object = (value: unknown): RecordData => value && typeof value === "object" && !Array.isArray(value) ? value as RecordData : {};
const name = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 250) : "";
const ordered = (first: string, second: string) => first < second ? -1 : first > second ? 1 : 0;

function records(payload: unknown, label: string) {
  const result = new Map<string, RecordData>();
  for (const value of financeRows(payload, label)) {
    const row = object(value);
    const id = financeSourceId(row.id);
    if (!id || result.has(id)) throw new Error(`ChurchTools returned an invalid or duplicate finance ${label} ID.`);
    result.set(id, row);
  }
  return result;
}

function codeCandidates<T extends LocalCode>(source: ReadonlyMap<string, string>, local: T[] | null) {
  const localByCode = new Map((local ?? []).map((row) => [row.code, row]));
  const counts = new Map<string, number>();
  for (const code of source.values()) counts.set(code, (counts.get(code) ?? 0) + 1);
  return [...source.entries()].sort(([firstId, first], [secondId, second]) => ordered(first, second) || ordered(firstId, secondId)).map(([sourceId, code]) => {
    const candidate = localByCode.get(code) ?? null;
    const codeStatus = !isChurchToolsMappingCodeSupported(code) ? "unsupported_code"
      : (counts.get(code) ?? 0) > 1 ? "duplicate_source_code"
        : !local ? "local_finance_unavailable"
          : !candidate ? "no_local_match"
            : candidate.active ? "active_code_match" : "inactive_local_match";
    return { sourceId, code, candidate, codeStatus };
  });
}

export function buildChurchToolsFinanceMapping(
  periodId: string,
  source: { accounts: unknown; costCenters: unknown; groups: unknown; classes: unknown; types: unknown },
  local: { accounts: LocalAccount[]; costCenters: LocalCode[] } | null,
) {
  const accountCodes = readChurchToolsFinanceCodes(source.accounts, periodId, "account");
  const costCenterCodes = readChurchToolsFinanceCodes(source.costCenters, periodId, "cost center");
  const accounts = records(source.accounts, "account");
  const groups = records(source.groups, "account group");
  const classes = records(source.classes, "account class");
  const types = records(source.types, "account type");
  const costCenters = records(source.costCenters, "cost center");

  return {
    accounts: codeCandidates(accountCodes, local?.accounts ?? null).map((entry) => {
      const account = accounts.get(entry.sourceId)!;
      const groupId = financeSourceId(account.accountGroupId);
      const group = groupId ? groups.get(groupId) : undefined;
      const classId = financeSourceId(group?.accountClassId);
      const accountClass = classId ? classes.get(classId) : undefined;
      const typeId = financeSourceId(accountClass?.accountTypeId);
      const type = typeId ? types.get(typeId) : undefined;
      const sourceClassification = type?.balanceType === "assets" ? "asset"
        : type?.balanceType === "liabilities" ? "liability_or_equity"
          : type?.balanceType === null ? "income_or_expense" : "unresolved";
      const targetType = entry.candidate?.accountType;
      const compatibleTypes: LocalAccount["accountType"][] = sourceClassification === "asset" ? ["asset"]
        : sourceClassification === "liability_or_equity" ? ["liability", "equity"]
          : sourceClassification === "income_or_expense" ? ["income", "expense"] : [];
      const typeReview = sourceClassification === "unresolved" ? "source_hierarchy_unresolved"
        : targetType && !compatibleTypes.includes(targetType) ? "incompatible_local_type"
          : sourceClassification !== "asset" ? "manual_classification_required"
            : account.isOpeningBalanceAccount === true || account.isDonationAccount === true || financeSourceId(account.taxRateId)
              ? "special_account_review_required" : "asset_classification";
      return {
        ...entry, sourceName: name(account.name), sourceClassification, typeReview,
        sourceHierarchy: {
          group: groupId ? { sourceId: groupId, name: name(group?.name) || null } : null,
          class: classId ? { sourceId: classId, name: name(accountClass?.name) || null } : null,
          type: typeId ? { sourceId: typeId, name: name(type?.name) || null } : null,
        },
        sourceFlags: { cashAsset: group?.isCashAssetAccount === true, openingBalance: account.isOpeningBalanceAccount === true,
          donation: account.isDonationAccount === true, taxRateConfigured: financeSourceId(account.taxRateId) !== null },
      };
    }),
    costCenters: codeCandidates(costCenterCodes, local?.costCenters ?? null).map((entry) => ({
      ...entry, sourceName: name(costCenters.get(entry.sourceId)?.name),
    })),
  };
}
