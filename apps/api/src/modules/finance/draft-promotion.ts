import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

export type DraftHeader = { id: string; bookingDate: string; accountingYear: number; receiptNumber: string; bookingText: string; status: string; reversesTransactionId: string | null };
export type DraftLine = {
  id: string; line_number: number; account_id: string; account_code: string; account_name: string; account_type: string; account_active: boolean;
  cost_center_id: string | null; donor_id: string | null; debit_cents: string | number; credit_cents: string | number; line_text: string;
};
type Child = { sourceId: string; documentNumber: string; signedMinor: string; sourceDebitAccountId: string; sourceCreditAccountId: string };
type AccountLink = { sourceId: string; targetId: string };
type Split = { parentId: string; documentNumber: string | null; date: string | null; children: Child[]; accountLinks: AccountLink[] };
export type DraftProvenance = { instanceUrl: string; periodId: string; sourceId: string; split?: Split };
const maxAmount = 9_000_000_000_000_000n;
const positiveId = /^[1-9][0-9]{0,15}$/;
const validMinor = /^(?:0|[1-9][0-9]{0,15})$/;
const validDocument = (value: unknown): value is string => typeof value === "string" && value.length <= 80
  && Boolean(value) && value === value.trim().replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ");

function sourceChildren(value: unknown): Child[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 1000) return null;
  const children: Child[] = [];
  for (const child of value) {
    if (!child || typeof child !== "object") return null;
    const { sourceId, documentNumber, signedMinor, sourceDebitAccountId, sourceCreditAccountId } = child;
    if (typeof sourceId !== "string" || !positiveId.test(sourceId) || !validDocument(documentNumber)
      || typeof signedMinor !== "string" || !positiveId.test(signedMinor)
      || typeof sourceDebitAccountId !== "string" || !positiveId.test(sourceDebitAccountId)
      || typeof sourceCreditAccountId !== "string" || !positiveId.test(sourceCreditAccountId)) return null;
    children.push({ sourceId, documentNumber, signedMinor, sourceDebitAccountId, sourceCreditAccountId });
  }
  if (new Set(children.map((child) => child.sourceId)).size !== children.length) return null;
  return children.sort((first, second) => first.sourceId.localeCompare(second.sourceId));
}

export async function readDraftProvenance(db: Pick<PoolClient, "query">, departmentId: string, transactionId: string, lock = false): Promise<DraftProvenance | null> {
  const result = await db.query<Pick<DraftProvenance, "instanceUrl" | "periodId" | "sourceId"> & { action: string; details: Record<string, unknown> }>(`
    SELECT link.instance_url AS "instanceUrl",link.period_id AS "periodId",link.source_id AS "sourceId",a.action,a.details
    FROM churchtools_migration_finance_journal_links link
    JOIN finance_audit a ON a.department_id=link.department_id AND a.record_id=link.target_id AND a.record_kind='transaction'
      AND a.action IN ('churchtools-journal-draft-created','churchtools-journal-split-draft-created')
      AND a.details->>'instanceUrl'=link.instance_url AND a.details->>'periodId'=link.period_id AND a.details->>'sourceId'=link.source_id
    WHERE link.department_id=$1 AND link.target_id=$2${lock ? " FOR SHARE OF link" : ""}`, [departmentId, transactionId]);
  if (result.rows.length !== 1) return null;
  const { action, details, ...source } = result.rows[0];
  if (action === "churchtools-journal-draft-created") return positiveId.test(source.sourceId) ? source : null;
  const parentId = details.sourceParentId;
  const children = sourceChildren(details.sourceChildren);
  if (typeof parentId !== "string" || !positiveId.test(parentId) || source.sourceId !== `split:${parentId}` || !children) return null;
  const documentNumber = details.sourceParentDocumentNumber;
  const date = details.sourceParentDate;
  if ((documentNumber !== undefined && !validDocument(documentNumber))
    || (date !== undefined && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)))) return null;
  const accountIds = [...new Set(children.flatMap((child) => [child.sourceDebitAccountId, child.sourceCreditAccountId]))];
  const args = [departmentId, source.instanceUrl, source.periodId];
  const [lineage, accountLinks] = await Promise.all([
    db.query<{ sourceId: string }>(`SELECT source_id AS "sourceId" FROM churchtools_migration_finance_split_draft_children
      WHERE department_id=$1 AND instance_url=$2 AND period_id=$3 AND parent_link_id=$4${lock ? " FOR SHARE" : ""}`, [...args, source.sourceId]),
    db.query<AccountLink>(`SELECT source_id AS "sourceId",target_id AS "targetId" FROM churchtools_migration_finance_links
      WHERE department_id=$1 AND instance_url=$2 AND period_id=$3 AND kind='account' AND source_id=ANY($4::text[])${lock ? " FOR SHARE" : ""}`, [...args, accountIds]),
  ]);
  const childIds = new Set(lineage.rows.map((child) => child.sourceId));
  if (lineage.rows.length !== children.length || children.some((child) => !childIds.has(child.sourceId)) || accountLinks.rows.length !== accountIds.length) return null;
  return { ...source, split: { parentId, documentNumber: validDocument(documentNumber) ? documentNumber : null, date: typeof date === "string" ? date : null,
    children, accountLinks: accountLinks.rows.sort((first, second) => first.sourceId.localeCompare(second.sourceId)) } };
}

function matchesSplit(header: DraftHeader, lines: DraftLine[], split: Split) {
  if ((split.documentNumber !== null && split.documentNumber !== header.receiptNumber) || (split.date !== null && split.date !== header.bookingDate)) return false;
  const debitSide = new Set(split.children.map((child) => child.sourceDebitAccountId));
  const creditSide = new Set(split.children.map((child) => child.sourceCreditAccountId));
  if ((debitSide.size !== 1 && creditSide.size !== 1) || [...debitSide].some((sourceId) => creditSide.has(sourceId))) return false;
  const crosswalk = new Map(split.accountLinks.map((link) => [link.sourceId, link.targetId]));
  const expected = new Map<string, { debit: bigint; credit: bigint }>();
  for (const child of split.children) {
    const debitAccount = crosswalk.get(child.sourceDebitAccountId);
    const creditAccount = crosswalk.get(child.sourceCreditAccountId);
    if (!debitAccount || !creditAccount || debitAccount === creditAccount) return false;
    const amount = BigInt(child.signedMinor);
    const debit = expected.get(debitAccount) ?? { debit: 0n, credit: 0n };
    const credit = expected.get(creditAccount) ?? { debit: 0n, credit: 0n };
    debit.debit += amount;
    credit.credit += amount;
    expected.set(debitAccount, debit);
    expected.set(creditAccount, credit);
  }
  return expected.size === lines.length && lines.every((line) => {
    const totals = expected.get(line.account_id);
    return totals?.debit === BigInt(line.debit_cents) && totals.credit === BigInt(line.credit_cents);
  });
}

export function draftReceiptNumbers(header: DraftHeader, source: DraftProvenance) {
  return [...new Set([header.receiptNumber, ...(source.split?.children.map((child) => child.documentNumber) ?? [])])];
}

export function reviewChurchToolsDraft(header: DraftHeader, lines: DraftLine[], currency: string, source: DraftProvenance) {
  if (header.status !== "draft" || header.reversesTransactionId || !validDocument(header.receiptNumber) || !header.bookingText.trim()
    || lines.length < 2 || lines.length > 100 || new Set(lines.map((line) => line.account_id)).size !== lines.length) return null;
  let debit = 0n;
  let credit = 0n;
  for (const [index, line] of lines.entries()) {
    const debitText = String(line.debit_cents);
    const creditText = String(line.credit_cents);
    if (!line.account_active || line.cost_center_id || line.donor_id || line.line_number !== index + 1
      || !validMinor.test(debitText) || !validMinor.test(creditText) || (debitText === "0") === (creditText === "0")) return null;
    debit += BigInt(debitText);
    credit += BigInt(creditText);
  }
  if (debit !== credit || debit <= 0n || debit > maxAmount) return null;
  if (source.split ? !matchesSplit(header, lines, source.split)
    : lines.length !== 2 || String(lines[0].credit_cents) !== "0" || String(lines[1].debit_cents) !== "0") return null;
  const payload: unknown[] = [header.id, header.bookingDate, header.accountingYear, header.receiptNumber, header.bookingText, currency,
    source.instanceUrl, source.periodId, source.sourceId, lines.map((line) => [
      line.id, line.line_number, line.account_id, line.account_code, line.account_name, line.account_type,
      String(line.debit_cents), String(line.credit_cents), line.line_text,
    ])];
  if (source.split) payload.push(source.split);
  return { reviewHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"), currency, source, debitMinor: debit.toString(), creditMinor: credit.toString() };
}
