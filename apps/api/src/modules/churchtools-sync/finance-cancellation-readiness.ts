import type { Pool } from "pg";
import type { reconcileChurchToolsSpecialJournal } from "./finance-special-review.js";

type Cancellation = ReturnType<typeof reconcileChurchToolsSpecialJournal>["cancellations"][number];
type LocalLine = { accountId: string; debit: string; credit: string; costCenterId: string | null; donorId: string | null };
type LocalOriginal = { sourceId: string; id: string; date: string; year: number; receipt: string; status: string;
  reversesId: string | null; reversalId: string | null; reversalDate: string | null; trusted: boolean; lines: LocalLine[] };
type LocalContext = { today: string; year: number | null; currency: string; occupiedReceipts: Set<string>;
  accounts: Map<string, string>; originals: Map<string, LocalOriginal>; linkedCancellations: Set<string> };
type Scope = { departmentId: string; instanceUrl: string; periodId: string; sourceCurrency: string; fullPeriodAccess: boolean; targetWritable: boolean };

function matchesOriginal(base: NonNullable<Cancellation["base"]>, original: LocalOriginal, accounts: Map<string, string>) {
  if (!base.debitAccountId || !base.creditAccountId || !base.signedMinor || !/^[1-9][0-9]*$/.test(base.signedMinor)
    || base.date !== original.date || base.documentNumber !== original.receipt) return false;
  const debit = accounts.get(base.debitAccountId);
  const credit = accounts.get(base.creditAccountId);
  if (!debit || !credit || debit === credit || original.lines.length !== 2) return false;
  return original.lines.every((line) => !line.costCenterId && !line.donorId)
    && original.lines.some((line) => line.accountId === debit && line.debit === base.signedMinor && line.credit === "0")
    && original.lines.some((line) => line.accountId === credit && line.credit === base.signedMinor && line.debit === "0");
}

export function reviewChurchToolsCancellationReadiness(pair: Cancellation, scope: Scope, local: LocalContext | null) {
  const original = pair.base ? local?.originals.get(pair.baseId) : undefined;
  const localOriginal = original ? {
    id: original.id, date: original.date, year: original.year, receipt: original.receipt, status: original.status,
    existingReversalId: original.reversalId, existingReversalDate: original.reversalDate,
  } : null;
  const blockers: string[] = [];
  if (pair.comparison !== "exact_source_posting_inverse") blockers.push("source_pair_not_verified");
  if (!scope.fullPeriodAccess) blockers.push("restricted_source_period");
  if (!scope.targetWritable) blockers.push("local_site_read_only");
  if (!local) blockers.push("local_finance_unavailable");
  else if (pair.base && !original) blockers.push("local_original_not_linked");
  if (local && original) {
    if (!original.trusted || !pair.base || !matchesOriginal(pair.base, original, local.accounts)) blockers.push("local_original_differs_from_source");
    if (original.status !== "posted") blockers.push("local_original_not_posted");
    if (original.reversesId) blockers.push("local_original_is_a_reversal");
    if (original.reversalId) blockers.push("local_original_already_reversed");
    if (pair.related && local.linkedCancellations.has(pair.related.sourceId)) blockers.push("source_cancellation_already_linked");
    if (scope.sourceCurrency !== local.currency) blockers.push("local_currency_differs_from_source");
    if (local.year === null) blockers.push("no_open_local_period_for_today");
    if (pair.related?.date !== local.today) blockers.push("native_reversal_uses_today");
    const receipt = `REV-${original.receipt}`.slice(0, 80);
    if (pair.related?.documentNumber !== receipt) blockers.push("native_reversal_uses_generated_receipt");
    if (local.occupiedReceipts.has(receipt)) blockers.push("native_reversal_receipt_in_use");
  }
  return { localOriginal, nativeReversalDate: local?.today ?? null, blockers };
}

export async function readChurchToolsCancellationReadiness(db: Pick<Pool, "query">, scope: Scope, cancellations: Cancellation[]) {
  const today = new Date().toISOString().slice(0, 10);
  const sourceIds = [...new Set(cancellations.flatMap(({ base, related }) =>
    [base?.sourceId, related?.sourceId].filter((id): id is string => !!id)))];
  if (!cancellations.length) return [];
  const { rows: [availability] } = await db.query<{ available: boolean }>(`SELECT
    to_regclass('public.finance_transactions') IS NOT NULL
    AND to_regclass('public.finance_transaction_lines') IS NOT NULL
    AND to_regclass('public.finance_accounting_years') IS NOT NULL
    AND to_regclass('public.finance_audit') IS NOT NULL
    AND to_regclass('public.finance_settings') IS NOT NULL
    AND to_regclass('public.churchtools_migration_finance_journal_links') IS NOT NULL
    AND to_regclass('public.churchtools_migration_finance_links') IS NOT NULL
    AND EXISTS (SELECT 1 FROM departments d JOIN installation_modules m ON m.installation_id=d.installation_id
      WHERE d.id=$1 AND m.module_id='finance' AND m.enabled) AS available`, [scope.departmentId]);
  let local: LocalContext | null = null;
  if (availability?.available) {
    const args = [scope.departmentId, scope.instanceUrl, scope.periodId];
    const sourceAccountIds = [...new Set(cancellations.flatMap(({ base }) =>
      [base?.debitAccountId, base?.creditAccountId].filter((id): id is string => !!id)))];
    const [links, accounts, settings, years] = await Promise.all([
      db.query<LocalOriginal | { id: null; sourceId: string }>(`SELECT link.source_id AS "sourceId",t.id,
        t.booking_date::text AS date,t.accounting_year AS year,t.receipt_number AS receipt,t.status,
        t.reverses_transaction_id AS "reversesId",r.id AS "reversalId",r.booking_date::text AS "reversalDate",
        EXISTS (SELECT 1 FROM finance_audit a WHERE a.department_id=link.department_id AND a.record_id=link.target_id
          AND a.record_kind='transaction' AND a.action='churchtools-journal-draft-created'
          AND a.details->>'instanceUrl'=link.instance_url AND a.details->>'periodId'=link.period_id
          AND a.details->>'sourceId'=link.source_id) AS trusted,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('accountId', l.account_id,'debit',l.debit_cents::text,
          'credit',l.credit_cents::text,'costCenterId',l.cost_center_id,'donorId',l.donor_id))
          FROM finance_transaction_lines l WHERE l.department_id=t.department_id AND l.transaction_id=t.id), '[]'::jsonb) AS lines
        FROM churchtools_migration_finance_journal_links link LEFT JOIN finance_transactions t
          ON t.department_id=link.department_id AND t.id=link.target_id
        LEFT JOIN finance_transactions r ON r.department_id=t.department_id AND r.reverses_transaction_id=t.id
        WHERE link.department_id=$1 AND link.instance_url=$2 AND link.period_id=$3 AND link.source_id=ANY($4::text[])`, [...args, sourceIds]),
      db.query<{ source_id: string; target_id: string }>(`SELECT source_id,target_id FROM churchtools_migration_finance_links
        WHERE department_id=$1 AND instance_url=$2 AND period_id=$3 AND kind='account' AND source_id=ANY($4::text[])`,
      [...args, sourceAccountIds]),
      db.query<{ currency_code: string }>("SELECT currency_code FROM finance_settings WHERE department_id=$1", [scope.departmentId]),
      db.query<{ accounting_year: number; status: string }>(`SELECT accounting_year,status FROM finance_accounting_years
        WHERE department_id=$1 AND start_date<=$2::date AND end_date>=$2::date`, [scope.departmentId, today]),
    ]);
    const originals = links.rows.filter((entry): entry is LocalOriginal => entry.id !== null);
    const year = years.rows.length === 1 && years.rows[0].status === "open" ? years.rows[0].accounting_year : null;
    const candidateReceipts = [...new Set(originals.map(({ receipt }) => `REV-${receipt}`.slice(0, 80)))];
    const receipts = year === null || !candidateReceipts.length ? [] : (await db.query<{ receipt: string }>(`SELECT receipt_number AS receipt
      FROM finance_transactions WHERE department_id=$1 AND accounting_year=$2 AND receipt_number=ANY($3::text[])
      UNION
      SELECT child->>'documentNumber' FROM finance_transactions t
      JOIN finance_audit a ON a.department_id=t.department_id AND a.record_id=t.id AND a.record_kind='transaction'
        AND a.action='churchtools-journal-split-draft-created'
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(a.details->'sourceChildren')='array'
        THEN a.details->'sourceChildren' ELSE '[]'::jsonb END) child
      WHERE t.department_id=$1 AND t.accounting_year=$2 AND child->>'documentNumber'=ANY($3::text[])`,
    [scope.departmentId, year, candidateReceipts])).rows;
    local = { today, year, currency: settings.rows[0]?.currency_code.trim() ?? "CHF", occupiedReceipts: new Set(receipts.map(({ receipt }) => receipt)),
      accounts: new Map(accounts.rows.map(({ source_id, target_id }) => [source_id, target_id])),
      originals: new Map(originals.map((original) => [original.sourceId, original])),
      linkedCancellations: new Set(links.rows.map(({ sourceId }) => sourceId)) };
  }
  return cancellations.map((pair) => ({ ...pair, localReview: reviewChurchToolsCancellationReadiness(pair, scope, local) }));
}
