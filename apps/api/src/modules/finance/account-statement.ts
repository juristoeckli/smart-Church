export type StatementLabel = { code: string; name: string };
export type AccountStatementLine = {
  id: string; lineId: string; bookingDate: string; accountingYear: number; receiptNumber: string;
  bookingText: string; lineText: string; debitCents: string; creditCents: string; runningBalanceCents: string;
  account: StatementLabel; costCenter: StatementLabel | null; counterAccounts: StatementLabel[];
};

export const accountStatementSql = `
  WITH history AS (
    SELECT t.id,t.booking_date,t.accounting_year,t.receipt_number,t.booking_text,t.created_at,
      l.id AS line_id,l.line_number,l.line_text,l.debit_cents,l.credit_cents,l.account_id,l.cost_center_id,
      sum(l.debit_cents-l.credit_cents) OVER (ORDER BY t.booking_date,t.created_at,t.id,l.line_number)::text AS balance
    FROM finance_transaction_lines l
    JOIN finance_transactions t ON t.id=l.transaction_id AND t.department_id=l.department_id
    WHERE l.department_id=$1 AND l.account_id=$2 AND t.status='posted'
      AND ($4::date IS NULL OR t.booking_date<=$4)
  )
  SELECT h.id,h.line_id AS "lineId",to_char(h.booking_date,'YYYY-MM-DD') AS "bookingDate",
    h.accounting_year AS "accountingYear",h.receipt_number AS "receiptNumber",h.booking_text AS "bookingText",
    h.line_text AS "lineText",h.debit_cents::text AS "debitCents",h.credit_cents::text AS "creditCents",h.balance AS "runningBalanceCents",
    jsonb_build_object('code',a.code,'name',a.name) AS account,
    CASE WHEN center.id IS NOT NULL THEN jsonb_build_object('code',center.code,'name',center.name) END AS "costCenter",
    COALESCE(counter_accounts.accounts,'[]') AS "counterAccounts"
  FROM history h
  JOIN finance_accounts a ON a.department_id=$1 AND a.id=h.account_id
  LEFT JOIN finance_cost_centers center ON center.department_id=$1 AND center.id=h.cost_center_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('code',counter.code,'name',counter.name) ORDER BY counter.code,counter.id) AS accounts
    FROM (
      SELECT DISTINCT opposite.account_id
      FROM finance_transaction_lines opposite
      WHERE opposite.department_id=$1 AND opposite.transaction_id=h.id
        AND ((h.debit_cents>0 AND opposite.credit_cents>0) OR (h.credit_cents>0 AND opposite.debit_cents>0))
    ) matched
    JOIN finance_accounts counter ON counter.department_id=$1 AND counter.id=matched.account_id
  ) counter_accounts ON true
  WHERE ($3::date IS NULL OR h.booking_date >= $3)
  ORDER BY h.booking_date,h.created_at,h.id,h.line_number
`;
