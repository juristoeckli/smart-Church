import { isJournalReceiptConflict } from "../finance/journal-numbering.js";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { buildChurchToolsFinanceJournalDryRun } from "./finance-journal-dry-run.js";
import { ChurchToolsFinanceReviewError, financeMappingHash } from "./finance-masterdata.js";

type Preview = ReturnType<typeof buildChurchToolsFinanceJournalDryRun>;
type Scope = { departmentId: string; instanceUrl: string; periodId: string };
type Result = { created: number; drafts: Array<{ sourceId: string; transactionId: string }> };
type Queryable = Pick<PoolClient, "query">;
type DraftRow = { sourceId: string; date: string; documentNumber: string;
  lines: Array<{ accountId: string; debitMinor: string; creditMinor: string }>;
  split?: { parentId: string; children: Array<{ sourceId: string; documentNumber: string | null; signedMinor: string | null; sourceDebitAccountId: string | null; sourceCreditAccountId: string | null }> };
};

export function journalDraftBatchId(reviewHash: string, sourceIds: string[], scope: { startDate: string; endDate: string; sourceCurrency: string }) {
  return financeMappingHash([reviewHash, scope.startDate, scope.endDate, scope.sourceCurrency, [...sourceIds].sort()]);
}
export async function readJournalDraftReceipt(db: Queryable, scope: Scope, batchId: string) {
  const receipt = await db.query<{ result: Result }>(`SELECT result FROM churchtools_migration_finance_journal_batches
    WHERE department_id=$1 AND instance_url=$2 AND period_id=$3 AND batch_id=$4`, [scope.departmentId, scope.instanceUrl, scope.periodId, batchId]);
  return receipt.rows[0]?.result;
}

export function planReviewedJournalDrafts(preview: Preview, sourceIds: string[]) {
  if (preview.blockedBy.length || preview.targetYear === null) throw new ChurchToolsFinanceReviewError("The journal period or currency does not permit draft creation.");
  if (!sourceIds.length || new Set(sourceIds).size !== sourceIds.length) throw new ChurchToolsFinanceReviewError("Select each journal row only once.");
  const byId = new Map(preview.rows.map((row) => [row.sourceId, row]));
  const rows = sourceIds.map((sourceId) => {
    const row = byId.get(sourceId);
    if (!row || !row.documentNumber || row.reasons.length || row.proposedTargetLines.length !== 2) {
      throw new ChurchToolsFinanceReviewError("A selected journal row still needs review or was already imported.");
    }
    const [debit, credit] = row.proposedTargetLines;
    if (debit.costCenterId !== null || credit.costCenterId !== null || debit.accountId === credit.accountId
      || debit.creditMinor !== "0" || credit.debitMinor !== "0" || debit.debitMinor !== credit.creditMinor || !/^[1-9][0-9]*$/.test(debit.debitMinor)) {
      throw new ChurchToolsFinanceReviewError("A selected journal row does not contain an eligible balanced posting pair.");
    }
    return { ...row, documentNumber: row.documentNumber, debit, credit };
  });
  return { targetYear: preview.targetYear, rows };
}

export function createReviewedJournalDrafts(db: Queryable, scope: Scope, actorId: string | null, batchId: string, plan: ReturnType<typeof planReviewedJournalDrafts>) {
  return createFinanceDraftBatch(db, scope, actorId, batchId, {
    targetYear: plan.targetYear, rows: plan.rows.map((row) => ({
      sourceId: row.sourceId, date: row.date, documentNumber: row.documentNumber, lines: [row.debit, row.credit],
    })),
  });
}

export async function createFinanceDraftBatch(db: Queryable, scope: Scope, actorId: string | null, batchId: string, plan: { targetYear: number; rows: DraftRow[] }): Promise<Result> {
  const { departmentId, instanceUrl, periodId } = scope;
  const drafts: Result["drafts"] = [];
  for (const row of plan.rows) {
    const transactionId = randomUUID();
    try {
      await db.query(`INSERT INTO finance_transactions(id,department_id,booking_date,accounting_year,receipt_number,booking_text,status,created_by)
        VALUES($1,$2,$3,$4,$5,$6,'draft',$7)`,
      [transactionId, departmentId, row.date, plan.targetYear, row.documentNumber,
        row.split ? `ChurchTools split journal draft #${row.split.parentId}` : `ChurchTools journal draft #${row.sourceId}`, actorId]);
    } catch (error) {
      if (isJournalReceiptConflict(error)) {
        throw new ChurchToolsFinanceReviewError("An imported receipt number matches an allocated journal number. Resolve the receipt-number conflict before retrying.");
      }
      throw error;
    }
    await db.query(`INSERT INTO finance_transaction_lines(id,department_id,transaction_id,line_number,account_id,debit_cents,credit_cents)
      SELECT line.id,$1,$2,line.position,line.account_id,line.debit,line.credit
      FROM jsonb_to_recordset($3::jsonb) AS line(id uuid,position integer,account_id uuid,debit bigint,credit bigint)`,
    [departmentId, transactionId, JSON.stringify(row.lines.map((line, index) => ({
      id: randomUUID(), position: index + 1, account_id: line.accountId, debit: line.debitMinor, credit: line.creditMinor,
    })))]);
    const link = await db.query(`INSERT INTO churchtools_migration_finance_journal_links(department_id,instance_url,period_id,source_id,target_id)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [departmentId, instanceUrl, periodId, row.sourceId, transactionId]);
    if (!link.rowCount) throw new ChurchToolsFinanceReviewError("A selected ChurchTools journal row was already linked.");
    if (row.split) {
      const childLinks = await db.query(`INSERT INTO churchtools_migration_finance_split_draft_children(department_id,instance_url,period_id,source_id,parent_link_id)
        SELECT $1,$2,$3,child.source_id,$4 FROM unnest($5::text[]) child(source_id) ON CONFLICT DO NOTHING`,
      [departmentId, instanceUrl, periodId, row.sourceId, row.split.children.map((child) => child.sourceId)]);
      if (childLinks.rowCount !== row.split.children.length) throw new ChurchToolsFinanceReviewError("A selected split child was already linked.");
    }
    await db.query(`INSERT INTO finance_audit(id,department_id,actor_user_id,action,record_kind,record_id,details)
      VALUES($1,$2,$3,$4,'transaction',$5,$6::jsonb)`,
    [randomUUID(), departmentId, actorId, row.split ? "churchtools-journal-split-draft-created" : "churchtools-journal-draft-created", transactionId,
      JSON.stringify({ instanceUrl, periodId, sourceId: row.sourceId, accountingYear: plan.targetYear, ...(row.split ? {
        sourceParentId: row.split.parentId, sourceParentDocumentNumber: row.documentNumber, sourceParentDate: row.date, sourceChildren: row.split.children,
      } : {}) })]);
    drafts.push({ sourceId: row.sourceId, transactionId });
  }
  const result = { created: drafts.length, drafts };
  await db.query(`INSERT INTO churchtools_migration_finance_journal_batches(department_id,instance_url,period_id,batch_id,result)
    VALUES($1,$2,$3,$4,$5::jsonb)`, [departmentId, instanceUrl, periodId, batchId, JSON.stringify(result)]);
  return result;
}
