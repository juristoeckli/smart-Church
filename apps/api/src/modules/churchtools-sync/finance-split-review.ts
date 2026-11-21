import { financeDay, financeSourceId } from "./finance-preview.js";
import { selectChurchToolsJournalRow } from "./finance-journal-dry-run.js";
import type { buildChurchToolsFinanceMapping } from "./finance-mapping.js";
import { ChurchToolsFinanceReviewError } from "./finance-masterdata.js";

type JournalRow = ReturnType<typeof selectChurchToolsJournalRow>;
type Mapping = ReturnType<typeof buildChurchToolsFinanceMapping>;
type Link = { kind: "account" | "cost_center"; source_id: string; target_id: string };
type Scope = { startDate: string; endDate: string };
const maxAmount = 9_000_000_000_000_000n;
const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function readChurchToolsSplitGroup(payload: unknown, parentId: string, scope: Scope) {
  const parent = record(record(payload).data);
  if (financeSourceId(parent.id) !== parentId || !financeDay(parent.documentDate) || !Array.isArray(parent.splitChildren)
    || parent.splitChildren.length < 2 || parent.splitChildren.length > 1000 || !Number.isSafeInteger(parent.amount)) {
    throw new Error("ChurchTools returned an invalid or incomplete split group.");
  }
  const children = parent.splitChildren.map((value) => {
    const child = record(value);
    if (!financeSourceId(child.id) || !financeDay(child.documentDate)) throw new Error("ChurchTools returned an invalid split child.");
    return selectChurchToolsJournalRow(child);
  });
  if (new Set(children.map((child) => child.sourceId)).size !== children.length) throw new Error("ChurchTools repeated a child in a split group.");
  const outside = (date: string) => date < scope.startDate || date > scope.endDate;
  if (outside(parent.documentDate) || children.some((child) => outside(child.date))) return null;
  return {
    parentId, date: parent.documentDate, documentNumber: selectChurchToolsJournalRow(parent).documentNumber,
    amount: BigInt(parent.amount as number), children,
  };
}

type Group = NonNullable<ReturnType<typeof readChurchToolsSplitGroup>>;

export function reconcileChurchToolsSplitGroup(group: Group, journal: JournalRow[], mapping: Mapping, links: Link[], periodBlockers: string[], duplicateLocalReceipt: boolean, duplicateParentReceipt = false) {
  const accounts = new Map(mapping.accounts.map((account) => [account.sourceId, account]));
  const centers = new Map(mapping.costCenters.map((center) => [center.sourceId, center]));
  const linkIds = new Map(links.map((link) => [`${link.kind}:${link.source_id}`, link.target_id]));
  const journalById = new Map(journal.map((row) => [row.sourceId, row]));
  const expected = journal.filter((row) => row.splitParentId === group.parentId);
  const childIds = new Set(group.children.map((row) => row.sourceId));
  const reasons: string[] = [];
  if (!expected.length || expected.some((row) => !childIds.has(row.sourceId)) || group.children.some((row) => {
    const prior = journalById.get(row.sourceId);
    return !prior || JSON.stringify(prior) !== JSON.stringify(row)
      || (row.splitParentId !== group.parentId && (!row.taxBaseId || !childIds.has(row.taxBaseId)));
  })) reasons.push("journal_children_unconfirmed");
  if (group.children.some((row) => row.date !== group.date)) reasons.push("split_child_date_mismatch");
  if (!group.documentNumber) reasons.push("unsupported_parent_document_number");
  if (duplicateLocalReceipt) reasons.push("duplicate_local_document");
  if (duplicateParentReceipt) reasons.push("duplicate_source_parent_document");
  if (journal.some((row) => group.documentNumber && row.documentNumber === group.documentNumber && !childIds.has(row.sourceId))) reasons.push("duplicate_source_document");
  const allAmounts = group.children.every((child) => child.amount !== null);
  const childTotal = allAmounts ? group.children.reduce((total, child) => total + BigInt(child.amount!), 0n) : null;
  if (childTotal === null || childTotal !== group.amount) reasons.push("parent_child_total_mismatch");
  if (group.amount <= 0n || group.amount > maxAmount || group.children.some((child) => child.amount === null || child.amount <= 0)) {
    reasons.push("nonpositive_or_unsupported_amount");
  }
  const ordinary = group.children.filter((row) => !row.taxBaseId);
  const debits = new Set(ordinary.map((row) => row.debitAccountId));
  const credits = new Set(ordinary.map((row) => row.creditAccountId));
  const sharedSide = ordinary.length > 1 && !debits.has(null) && !credits.has(null) && ![...debits].some((id) => credits.has(id))
    ? debits.size === 1 && credits.size === 1 ? "both" : debits.size === 1 ? "debit" : credits.size === 1 ? "credit" : null
    : null;
  if (!sharedSide) reasons.push("unconfirmed_common_account_side");
  function accountCandidate(sourceId: string | null) {
    const source = sourceId ? accounts.get(sourceId) : undefined;
    const target = source?.codeStatus === "active_code_match" ? source.candidate : null;
    const compatible = source?.typeReview === "asset_classification" || source?.typeReview === "manual_classification_required";
    const special = source?.sourceFlags.openingBalance || source?.sourceFlags.donation || source?.sourceFlags.taxRateConfigured;
    return target?.id && compatible && !special && target.id === linkIds.get(`account:${sourceId}`) ? { id: target.id, code: target.code } : null;
  }
  const childReview = group.children.map((child) => {
    const debit = accountCandidate(child.debitAccountId);
    const credit = accountCandidate(child.creditAccountId);
    const sourceCenter = child.costCenterId ? centers.get(child.costCenterId) : undefined;
    const center = sourceCenter?.codeStatus === "active_code_match" ? sourceCenter.candidate : null;
    const linkedCenterCode = center?.id && center.id === linkIds.get(`cost_center:${child.costCenterId}`) ? center.code : null;
    const warnings = Object.entries(child.flags).flatMap(([flag, set]) => flag !== "split" && set ? [`source_${flag}`] : []);
    if (!debit || !credit) warnings.push("unresolved_account_link");
    if (child.costCenterId) warnings.push(linkedCenterCode ? "cost_center_allocation_review" : "unresolved_cost_center_link");
    return { sourceId: child.sourceId, documentNumber: child.documentNumber || null, date: child.date, signedMinor: child.amount?.toString() ?? null,
      sourceDebitAccountId: child.debitAccountId, sourceCreditAccountId: child.creditAccountId, sourceCostCenterId: child.costCenterId,
      generatedTaxBaseId: child.taxBaseId, linkedCenterCode, debit, credit, warnings };
  });
  const childrenNeedReview = childReview.some((row) => row.warnings.length);
  if (childrenNeedReview) reasons.push("split_children_need_review");
  const targetLines = new Map<string, { accountId: string; accountCode: string; debit: bigint; credit: bigint }>();
  if (!reasons.length && !periodBlockers.length) {
    for (const child of childReview) {
      const amount = BigInt(child.signedMinor!);
      for (const [target, side] of [[child.debit!, "debit"], [child.credit!, "credit"]] as const) {
        const line = targetLines.get(target.id) ?? { accountId: target.id, accountCode: target.code, debit: 0n, credit: 0n };
        line[side] += amount;
        targetLines.set(target.id, line);
      }
    }
    if ([...targetLines.values()].some((line) => line.debit > 0n && line.credit > 0n)) {
      targetLines.clear();
      reasons.push("local_account_used_on_both_sides");
    }
    if (targetLines.size > 100) {
      targetLines.clear();
      reasons.push("too_many_local_posting_lines");
    }
  }
  return {
    parentId: group.parentId, date: group.date, documentNumber: group.documentNumber || null, parentSignedMinor: group.amount.toString(),
    childSignedTotalMinor: childTotal?.toString() ?? null, expectedChildren: expected.length, sharedSide, reasons, children: childReview,
    proposedTargetLines: [...targetLines.values()].sort((first, second) => first.accountCode.localeCompare(second.accountCode))
      .map((line) => ({ accountId: line.accountId, accountCode: line.accountCode, debitMinor: line.debit.toString(), creditMinor: line.credit.toString() })),
  };
}

export function planReviewedSplitDrafts(preview: {
  targetYear: number | null; blockedBy: string[];
  groups: Array<{ parentId: string; state: string; review: ReturnType<typeof reconcileChurchToolsSplitGroup> | null }>;
}, parentIds: string[]) {
  if (preview.blockedBy.length || preview.targetYear === null) throw new ChurchToolsFinanceReviewError("The journal period or currency does not permit split draft creation.");
  if (!parentIds.length || new Set(parentIds).size !== parentIds.length) throw new ChurchToolsFinanceReviewError("Select each split parent only once.");
  const groups = new Map(preview.groups.map((group) => [group.parentId, group]));
  const usedChildren = new Set<string>();
  const rows = parentIds.map((parentId) => {
    const group = groups.get(parentId);
    const review = group?.review;
    if (group?.state !== "available" || !review?.documentNumber || review.reasons.length
      || review.proposedTargetLines.length < 2 || review.proposedTargetLines.length > 100
      || !/^[1-9][0-9]{0,15}$/.test(review.parentSignedMinor)) {
      throw new ChurchToolsFinanceReviewError("A selected split group still needs review or was already imported.");
    }
    const gross = BigInt(review.parentSignedMinor);
    const valid = gross <= maxAmount && new Set(review.proposedTargetLines.map((line) => line.accountId)).size === review.proposedTargetLines.length
      && review.proposedTargetLines.every((line) => (
        line.debitMinor === "0" && /^[1-9][0-9]{0,15}$/.test(line.creditMinor)
        || line.creditMinor === "0" && /^[1-9][0-9]{0,15}$/.test(line.debitMinor)
      ));
    if (!valid || review.proposedTargetLines.reduce((sum, line) => sum + BigInt(line.debitMinor), 0n) !== gross
      || review.proposedTargetLines.reduce((sum, line) => sum + BigInt(line.creditMinor), 0n) !== gross) {
      throw new ChurchToolsFinanceReviewError("A selected split group no longer has balanced local lines.");
    }
    const children = review.children.map(({ sourceId, documentNumber, signedMinor, sourceDebitAccountId, sourceCreditAccountId }) => {
      if (usedChildren.has(sourceId)) throw new ChurchToolsFinanceReviewError("A split child occurs in more than one selected parent.");
      usedChildren.add(sourceId);
      return { sourceId, documentNumber, signedMinor, sourceDebitAccountId, sourceCreditAccountId };
    });
    return { sourceId: `split:${parentId}`, date: review.date, documentNumber: review.documentNumber,
      lines: review.proposedTargetLines, split: { parentId, children } };
  });
  return { targetYear: preview.targetYear, rows };
}
