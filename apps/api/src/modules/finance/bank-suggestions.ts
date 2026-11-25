import type { Pool, PoolClient } from "pg";

type StatementRow = {
  date: string;
  amount: number | string;
  description: string;
  reference: string;
};
type BankCandidate = {
  id: string;
  booking_date: string;
  receipt_number: string;
  booking_text: string;
  amount_cents: string;
};

// A recorded NULL explicitly clears a suggestion from the original statement import.
export const currentBankSuggestion = (row: string, suggestion: string) =>
  `CASE WHEN ${suggestion}.row_id IS NOT NULL THEN ${suggestion}.transaction_id ELSE ${row}.suggested_transaction_id END`;

export const currentBankStatus = (row: string, suggestion: string) =>
  `CASE WHEN ${row}.status IN ('matched','ignored') THEN ${row}.status
    WHEN (${currentBankSuggestion(row, suggestion)}) IS NOT NULL THEN 'suggested' ELSE 'unmatched' END`;

export async function bankStatementSuggestions(
  db: Pool | PoolClient,
  departmentId: string,
  accountId: string,
  rows: StatementRow[],
) {
  if (!rows.length) return { suggestions: [], ruleCount: 0, ruleAppliedRows: 0 };
  const minDate = rows.reduce((min, row) => row.date < min ? row.date : min, rows[0]!.date);
  const maxDate = rows.reduce((max, row) => row.date > max ? row.date : max, rows[0]!.date);
  const amounts = [...new Set(rows.map(row => String(row.amount)))];
  const candidates = await db.query<BankCandidate>(
    `SELECT journal.id,journal.booking_date::text,journal.receipt_number,journal.booking_text,
            sum(line.debit_cents-line.credit_cents)::text AS amount_cents
       FROM finance_transactions journal
       JOIN finance_transaction_lines line ON line.department_id=journal.department_id AND line.transaction_id=journal.id
      WHERE journal.department_id=$1 AND journal.status='posted' AND line.account_id=$2
        AND journal.booking_date BETWEEN ($3::date - 3) AND ($4::date + 3)
        AND NOT EXISTS (SELECT 1 FROM finance_bank_statement_rows matched
          WHERE matched.department_id=journal.department_id AND matched.status='matched'
            AND matched.matched_transaction_id=journal.id)
      GROUP BY journal.id HAVING sum(line.debit_cents-line.credit_cents)=ANY($5::bigint[])
      ORDER BY journal.booking_date DESC,journal.id LIMIT 20001`, [departmentId, accountId, minDate, maxDate, amounts]);
  const ruleRows = await db.query<{ statement_contains: string; transaction_contains: string }>(
    "SELECT statement_contains,transaction_contains FROM finance_bank_suggestion_rules WHERE department_id=$1 AND account_id=$2 AND active ORDER BY priority DESC,created_at,id LIMIT 500",
    [departmentId, accountId],
  );
  // Do not present a single candidate as unique when the query could not load all possible matches.
  if (candidates.rows.length > 20_000) return { suggestions: rows.map(() => null), ruleCount: ruleRows.rows.length, ruleAppliedRows: 0 };
  const rules = ruleRows.rows.map(rule => ({ statement: rule.statement_contains.toLocaleLowerCase(), transaction: rule.transaction_contains.toLocaleLowerCase() }));
  type SearchItem = { id: string; day: number; text: string };
  const byAmount = new Map<string, SearchItem[]>();
  const msPerDay = 86_400_000;
  for (const candidate of candidates.rows) {
    const bucket = byAmount.get(candidate.amount_cents) ?? [];
    bucket.push({ id: candidate.id, day: Date.parse(candidate.booking_date) / msPerDay,
      text: `${candidate.booking_text} ${candidate.receipt_number}`.toLocaleLowerCase() });
    byAmount.set(candidate.amount_cents, bucket);
  }
  let ruleAppliedRows = 0;
  const suggestions = rows.map(row => {
    const text = `${row.description} ${row.reference}`.toLocaleLowerCase();
    const rule = rules.find(rule => text.includes(rule.statement));
    if (rule) ruleAppliedRows += 1;
    const day = Date.parse(row.date) / msPerDay;
    let match: string | null = null;
    for (const item of byAmount.get(String(row.amount)) ?? []) {
      if (Math.abs(item.day - day) > 3 || (rule && !item.text.includes(rule.transaction))) continue;
      if (match !== null) return null;
      match = item.id;
    }
    return match;
  });
  return { suggestions, ruleCount: rules.length, ruleAppliedRows };
}
