import type { selectChurchToolsJournalRow } from "./finance-journal-dry-run.js";

type SourceRow = ReturnType<typeof selectChurchToolsJournalRow>;
type LinkKeys = readonly [base: "taxBaseId" | "stornoBaseId", related: "taxTransactionId" | "stornoTransactionId"];

function sourceEvidence(row: SourceRow | undefined) {
  if (!row) return null;
  const { sourceId, date, documentNumber, amount, debitAccountId, creditAccountId, costCenterId,
    contraCostCenterId, splitParentId, taxBaseId, taxTransactionId, taxRateId, stornoBaseId, stornoTransactionId } = row;
  return { sourceId, date, documentNumber: documentNumber || null, signedMinor: amount?.toString() ?? null,
    debitAccountId, creditAccountId, costCenterId, contraCostCenterId, splitParentId, taxBaseId, taxTransactionId,
    taxRateId, stornoBaseId, stornoTransactionId };
}

function sourcePairs(rows: readonly SourceRow[], [baseKey, relatedKey]: LinkKeys, keepUnlinked: (row: SourceRow) => boolean) {
  const visible = new Map(rows.map((row) => [row.sourceId, row]));
  const candidates = new Map<string, [baseId: string, relatedId: string | null]>();
  for (const row of rows) {
    const baseId = row[baseKey];
    const relatedId = row[relatedKey];
    if (baseId) candidates.set(`${baseId}:${row.sourceId}`, [baseId, row.sourceId]);
    if (relatedId || (!baseId && keepUnlinked(row))) candidates.set(`${row.sourceId}:${relatedId ?? ""}`, [row.sourceId, relatedId]);
  }
  const relatedCounts = new Map<string, number>();
  const baseCounts = new Map<string, number>();
  for (const [baseId, relatedId] of candidates.values()) {
    if (!relatedId) continue;
    relatedCounts.set(baseId, (relatedCounts.get(baseId) ?? 0) + 1);
    baseCounts.set(relatedId, (baseCounts.get(relatedId) ?? 0) + 1);
  }
  return Array.from(candidates.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([, [baseId, relatedId]]) => {
    const base = visible.get(baseId);
    const related = relatedId ? visible.get(relatedId) : undefined;
    const link = !relatedId ? "no_counterpart_reference"
      : baseId === relatedId ? "self_reference"
      : !base || !related ? "counterpart_not_visible_in_range"
      : (relatedCounts.get(baseId) ?? 0) > 1 || (baseCounts.get(relatedId) ?? 0) > 1 ? "conflicting_references"
      : base[relatedKey] !== relatedId || related[baseKey] !== baseId ? "nonreciprocal_reference"
      : base[baseKey] || related[relatedKey] ? "chained_reference"
      : "reciprocal";
    return { baseId, relatedId, base, related, link };
  });
}

function compareCancellation(base: SourceRow, cancellation: SourceRow) {
  if (base.splitParentId || cancellation.splitParentId || base.flags.tax || cancellation.flags.tax
    || base.costCenterId || cancellation.costCenterId
    || base.flags.transfer || cancellation.flags.transfer || base.flags.invalidCostCenter || cancellation.flags.invalidCostCenter
    || base.flags.discount || cancellation.flags.discount || base.flags.donation || cancellation.flags.donation) {
    return "additional_postings_require_review";
  }
  if (!base.debitAccountId || !base.creditAccountId || !cancellation.debitAccountId || !cancellation.creditAccountId
    || !base.amount || !cancellation.amount) return "incomplete_posting_evidence";
  const sameSides = base.debitAccountId === cancellation.debitAccountId && base.creditAccountId === cancellation.creditAccountId;
  const swappedSides = base.debitAccountId === cancellation.creditAccountId && base.creditAccountId === cancellation.debitAccountId;
  const exactInverse = (sameSides && BigInt(base.amount) === -BigInt(cancellation.amount))
    || (swappedSides && base.amount === cancellation.amount);
  return exactInverse ? "exact_source_posting_inverse" : "source_posting_inverse_differs";
}

export function reconcileChurchToolsSpecialJournal(rows: readonly SourceRow[]) {
  const splitParentIds = new Set(rows.flatMap((row) => row.splitParentId ? [row.splitParentId] : []));
  const taxGroups = sourcePairs(rows, ["taxBaseId", "taxTransactionId"], (row) => Boolean(row.taxRateId))
    .map(({ baseId, relatedId, base, related, link }) => ({
      baseId, relatedId, link, base: sourceEvidence(base), related: sourceEvidence(related),
      grossSignedMinor: link === "reciprocal" && base?.amount != null && related?.amount != null
        ? (BigInt(base.amount) + BigInt(related.amount)).toString() : null,
    }));
  const cancellations = sourcePairs(rows, ["stornoBaseId", "stornoTransactionId"], () => false)
    .map(({ baseId, relatedId, base, related, link }) => ({
      baseId, relatedId, link, base: sourceEvidence(base), related: sourceEvidence(related),
      comparison: link !== "reciprocal" || !base || !related ? "not_compared"
        : splitParentIds.has(baseId) || splitParentIds.has(related.sourceId) ? "additional_postings_require_review"
        : compareCancellation(base, related),
    }));
  return { observedRows: rows.length, taxGroups, cancellations };
}
