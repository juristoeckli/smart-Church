import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { buildChurchToolsFinanceJournalDryRun } from "./finance-journal-dry-run.js";
import { ChurchToolsFinanceReviewError, financeMappingHash } from "./finance-masterdata.js";

type Preview = ReturnType<typeof buildChurchToolsFinanceJournalDryRun>;
type Scope = { departmentId: string; instanceUrl: string; periodId: string };
type Result = { created: number; drafts: Array<{ sourceId: string; transactionId: string }> };
type Queryable = Pick<PoolClient, "query">;

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

export async function createReviewedJournalDrafts(db: Queryable, scope: Scope, actorId: string | null, batchId: string, plan: ReturnType<typeof planReviewedJournalDrafts>): Promise<Result> {
  const { departmentId, instanceUrl, periodId } = scope;
  const drafts: Result["drafts"] = [];
  for (const row of plan.rows) {
    const transactionId = randomUUID();
    await db.query(`INSERT INTO finance_transactions(id,department_id,booking_date,accounting_year,receipt_number,booking_text,status,created_by)
      VALUES($1,$2,$3,$4,$5,$6,'draft',$7)`,
    [transactionId, departmentId, row.date, plan.targetYear, row.documentNumber, `ChurchTools journal draft #${row.sourceId}`, actorId]);
    await db.query(`INSERT INTO finance_transaction_lines(id,department_id,transaction_id,line_number,account_id,debit_cents,credit_cents)
      VALUES($1,$3,$4,1,$5,$7::bigint,0),($2,$3,$4,2,$6,0,$7::bigint)`,
    [randomUUID(), randomUUID(), departmentId, transactionId, row.debit.accountId, row.credit.accountId, row.debit.debitMinor]);
    const link = await db.query(`INSERT INTO churchtools_migration_finance_journal_links(department_id,instance_url,period_id,source_id,target_id)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [departmentId, instanceUrl, periodId, row.sourceId, transactionId]);
    if (!link.rowCount) throw new ChurchToolsFinanceReviewError("A selected ChurchTools journal row was already linked.");
    await db.query(`INSERT INTO finance_audit(id,department_id,actor_user_id,action,record_kind,record_id,details)
      VALUES($1,$2,$3,'churchtools-journal-draft-created','transaction',$4,$5::jsonb)`,
    [randomUUID(), departmentId, actorId, transactionId, JSON.stringify({ instanceUrl, periodId, sourceId: row.sourceId, accountingYear: plan.targetYear })]);
    drafts.push({ sourceId: row.sourceId, transactionId });
  }
  const result = { created: drafts.length, drafts };
  await db.query(`INSERT INTO churchtools_migration_finance_journal_batches(department_id,instance_url,period_id,batch_id,result)
    VALUES($1,$2,$3,$4,$5::jsonb)`, [departmentId, instanceUrl, periodId, batchId, JSON.stringify(result)]);
  return result;
}
