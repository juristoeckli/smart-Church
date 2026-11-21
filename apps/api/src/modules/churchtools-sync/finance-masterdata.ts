import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { buildChurchToolsFinanceMapping } from "./finance-mapping.js";

type Mapping = ReturnType<typeof buildChurchToolsFinanceMapping>;
type Account = Mapping["accounts"][number];
type CostCenter = Mapping["costCenters"][number];
export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
export type FinanceSelection = { kind: "account" | "cost_center"; sourceId: string; action: "link" | "create"; accountType?: AccountType };
type Result = { created: number; linked: number; alreadyLinked: number };
type Scope = { departmentId: string; instanceUrl: string; periodId: string };
type Queryable = Pick<PoolClient, "query">;
type Planned = { selection: FinanceSelection; row: Account | CostCenter; createName: string };

export class ChurchToolsFinanceReviewError extends Error {}
export const financeMappingHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function financeBatchId(reviewHash: string, selections: FinanceSelection[]) {
  const ordered = selections.map(({ kind, sourceId, action, accountType }) => [kind, sourceId, action, accountType ?? null])
    .sort((first, second) => JSON.stringify(first).localeCompare(JSON.stringify(second)));
  return financeMappingHash([reviewHash, ordered]);
}

export function planChurchToolsFinanceMasterData(mapping: Mapping, selections: FinanceSelection[]) {
  const accounts = new Map(mapping.accounts.map((row) => [row.sourceId, row]));
  const centers = new Map(mapping.costCenters.map((row) => [row.sourceId, row]));
  const seen = new Set<string>();
  return selections.map((selection): Planned => {
    const key = `${selection.kind}:${selection.sourceId}`;
    if (seen.has(key)) throw new ChurchToolsFinanceReviewError("Select each source record only once.");
    seen.add(key);
    const account = selection.kind === "account" ? accounts.get(selection.sourceId) : undefined;
    const row = selection.kind === "account" ? account : centers.get(selection.sourceId);
    if (!row || (selection.action === "create" && row.codeStatus !== "no_local_match")
      || (selection.action === "link" && row.codeStatus !== "active_code_match")) {
      throw new ChurchToolsFinanceReviewError("The selected record no longer has the requested mapping option.");
    }
    if (account) {
      const type = selection.accountType;
      const compatible = account.sourceClassification === "asset" ? type === "asset"
        : account.sourceClassification === "liability_or_equity" ? type === "liability" || type === "equity"
          : account.sourceClassification === "income_or_expense" && (type === "income" || type === "expense");
      if (!compatible || (selection.action === "link" && account.candidate?.accountType !== type)) {
        throw new ChurchToolsFinanceReviewError("Select an explicit Smart-Church account type compatible with the source and the chosen target.");
      }
      if (selection.action === "create" && (account.sourceFlags.openingBalance || account.sourceFlags.donation || account.sourceFlags.taxRateConfigured)) {
        throw new ChurchToolsFinanceReviewError("Opening-balance, donation, and tax-configured accounts need a locally configured account before linking.");
      }
    } else if (selection.accountType) throw new ChurchToolsFinanceReviewError("Cost centers do not have an account type.");
    const createName = row.sourceName.replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ");
    if (selection.action === "create" && (!createName || createName.length > 160)) throw new ChurchToolsFinanceReviewError("The source name requires review before creating this record.");
    return { selection, row, createName };
  });
}

export async function readChurchToolsFinanceReceipt(db: Queryable, scope: Scope, batchId: string) {
  const receipt = await db.query<{ result: Result }>(`SELECT result FROM churchtools_migration_finance_receipts
    WHERE department_id=$1 AND instance_url=$2 AND period_id=$3 AND batch_id=$4`,
  [scope.departmentId, scope.instanceUrl, scope.periodId, batchId]);
  return receipt.rows[0]?.result;
}

export async function applyChurchToolsFinanceMasterData(db: Queryable, scope: Scope, actorId: string | null, batchId: string, planned: Planned[]): Promise<Result> {
  const { departmentId, instanceUrl, periodId } = scope;
  const result: Result = { created: 0, linked: 0, alreadyLinked: 0 };
  for (const item of planned) {
    const { selection, row, createName } = item;
    const account = selection.kind === "account";
    const table = account ? "finance_accounts" : "finance_cost_centers";
    const linked = await db.query<{ target_id: string }>(`SELECT target_id FROM churchtools_migration_finance_links
      WHERE department_id=$1 AND instance_url=$2 AND period_id=$3 AND kind=$4 AND source_id=$5`,
    [departmentId, instanceUrl, periodId, selection.kind, selection.sourceId]);
    const current = await db.query<{ id: string; name: string; active: boolean; account_type?: AccountType }>(
      `SELECT id,name,active${account ? ",account_type" : ""} FROM ${table} WHERE department_id=$1 AND code=$2 FOR UPDATE`, [departmentId, row.code],
    );
    let targetId: string;
    if (selection.action === "link") {
      const target = current.rows[0];
      const candidate = row.candidate;
      if (!target?.active || !candidate || target.id !== candidate.id || target.name !== candidate.name || (account && target.account_type !== selection.accountType)) {
        throw new ChurchToolsFinanceReviewError("A selected local account or cost center changed. Load a fresh review.");
      }
      targetId = target.id;
      if (linked.rows[0]?.target_id === targetId) { result.alreadyLinked += 1; continue; }
    } else {
      if (linked.rowCount || current.rowCount) throw new ChurchToolsFinanceReviewError("This source record or local code already exists. Load a fresh review.");
      targetId = randomUUID();
      const values = [targetId, departmentId, row.code, createName];
      const inserted = account
        ? await db.query("INSERT INTO finance_accounts(id,department_id,code,name,account_type) VALUES($1,$2,$3,$4,$5) ON CONFLICT(department_id,code) DO NOTHING", [...values, selection.accountType])
        : await db.query("INSERT INTO finance_cost_centers(id,department_id,code,name) VALUES($1,$2,$3,$4) ON CONFLICT(department_id,code) DO NOTHING", values);
      if (!inserted.rowCount) throw new ChurchToolsFinanceReviewError("A matching local code was created after review. Load a fresh review.");
    }
    if (linked.rowCount) throw new ChurchToolsFinanceReviewError("A source record is already linked to a different local record.");
    const crosswalk = await db.query(`INSERT INTO churchtools_migration_finance_links(department_id,instance_url,period_id,kind,source_id,target_id)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [departmentId, instanceUrl, periodId, selection.kind, selection.sourceId, targetId]);
    if (!crosswalk.rowCount) throw new ChurchToolsFinanceReviewError("That local account or cost center is already linked in this source period.");
    await db.query(`INSERT INTO finance_audit(id,department_id,actor_user_id,action,record_kind,record_id,details)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`, [randomUUID(), departmentId, actorId, selection.action === "create" ? "churchtools-masterdata-created" : "churchtools-masterdata-linked", selection.kind, targetId,
      JSON.stringify({ sourceSystem: "churchtools", instanceUrl, periodId, sourceId: selection.sourceId, code: row.code })]);
    if (selection.action === "create") result.created += 1;
    else result.linked += 1;
  }
  await db.query(`INSERT INTO churchtools_migration_finance_receipts(department_id,instance_url,period_id,batch_id,result)
    VALUES($1,$2,$3,$4,$5::jsonb)`, [departmentId, instanceUrl, periodId, batchId, JSON.stringify(result)]);
  return result;
}
