import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

export type DraftHeader = { id: string; bookingDate: string; accountingYear: number; receiptNumber: string; bookingText: string; status: string; reversesTransactionId: string | null };
export type DraftLine = {
  id: string; line_number: number; account_id: string; account_code: string; account_name: string; account_type: string; account_active: boolean;
  cost_center_id: string | null; donor_id: string | null; debit_cents: string | number; credit_cents: string | number; line_text: string;
};
export type DraftProvenance = { instanceUrl: string; periodId: string; sourceId: string };
const maxAmount = 9_000_000_000_000_000n;

export async function readDraftProvenance(db: Pick<PoolClient, "query">, departmentId: string, transactionId: string, lock = false) {
  const result = await db.query<DraftProvenance>(`SELECT link.instance_url AS "instanceUrl", link.period_id AS "periodId", link.source_id AS "sourceId"
    FROM churchtools_migration_finance_journal_links link
    WHERE link.department_id=$1 AND link.target_id=$2 AND EXISTS (
      SELECT 1 FROM finance_audit a WHERE a.department_id=link.department_id AND a.record_id=link.target_id
        AND a.record_kind='transaction' AND a.action='churchtools-journal-draft-created'
        AND a.details->>'instanceUrl'=link.instance_url AND a.details->>'periodId'=link.period_id AND a.details->>'sourceId'=link.source_id
    )${lock ? " FOR SHARE OF link" : ""}`, [departmentId, transactionId]);
  return result.rows[0] ?? null;
}

export function reviewChurchToolsDraft(header: DraftHeader, lines: DraftLine[], currency: string, source: DraftProvenance) {
  if (header.status !== "draft" || header.reversesTransactionId || !header.receiptNumber.trim() || !header.bookingText.trim()
    || lines.length !== 2 || lines.some((line) => !line.account_active || line.cost_center_id || line.donor_id)) return null;
  const [debit, credit] = lines;
  const debitMinor = String(debit.debit_cents);
  const creditMinor = String(credit.credit_cents);
  if (debit.line_number !== 1 || credit.line_number !== 2 || debit.account_id === credit.account_id || String(debit.credit_cents) !== "0"
    || String(credit.debit_cents) !== "0" || debitMinor !== creditMinor || !/^[1-9][0-9]{0,15}$/.test(debitMinor) || BigInt(debitMinor) > maxAmount) return null;
  const payload = [header.id, header.bookingDate, header.accountingYear, header.receiptNumber, header.bookingText, currency,
    source.instanceUrl, source.periodId, source.sourceId, lines.map((line) => [
      line.id, line.line_number, line.account_id, line.account_code, line.account_name, line.account_type,
      String(line.debit_cents), String(line.credit_cents), line.line_text,
    ])];
  return { reviewHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"), currency, source, debitMinor, creditMinor };
}
