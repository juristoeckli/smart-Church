export type StatementScope = {
  code: string; name: string; fiscalStart: string; fiscalEnd: string; currency: string;
};
export const costCenterScopeSql = `
  SELECT c.code,c.name,to_char(fiscal.start_date,'YYYY-MM-DD') AS "fiscalStart",
    to_char(fiscal.end_date,'YYYY-MM-DD') AS "fiscalEnd",COALESCE(settings.currency_code,'CHF') AS currency
  FROM finance_cost_centers c
  JOIN finance_accounting_years fiscal ON fiscal.department_id=c.department_id AND fiscal.accounting_year=$3
  LEFT JOIN finance_settings settings ON settings.department_id=c.department_id
  WHERE c.department_id=$1 AND c.id=$2
`;

export type StatementEntry = {
  id: string; transactionId: string; date: string; receiptNumber: string; bookingText: string; lineText: string;
  accountCode: string; accountName: string; debitCents: string; creditCents: string;
};
export const costCenterEntriesSql = `
  SELECT line.id,t.id AS "transactionId",to_char(t.booking_date,'YYYY-MM-DD') AS date,
    t.receipt_number AS "receiptNumber",t.booking_text AS "bookingText",line.line_text AS "lineText",
    a.code AS "accountCode",a.name AS "accountName",
    line.debit_cents::text AS "debitCents",line.credit_cents::text AS "creditCents"
  FROM finance_transactions t
  JOIN finance_transaction_lines line ON line.department_id=t.department_id AND line.transaction_id=t.id
  JOIN finance_accounts a ON a.department_id=line.department_id AND a.id=line.account_id
  WHERE t.department_id=$1 AND line.cost_center_id=$2 AND t.accounting_year=$3 AND t.status='posted'
    AND t.booking_date BETWEEN $4::date AND $5::date
  ORDER BY t.booking_date,t.created_at,t.id,line.line_number LIMIT $6 OFFSET $7
`;

export type StatementBudget = {
  id: string; accountCode: string | null; accountName: string | null; budgetCents: string; actualCents: string; remainingCents: string;
};
export const costCenterBudgetSql = `
  WITH actual_by_account AS (
    SELECT a.id AS account_id,sum(CASE WHEN a.account_type='income' THEN line.credit_cents-line.debit_cents
                                     ELSE line.debit_cents-line.credit_cents END) AS actual
    FROM finance_transactions t
    JOIN finance_transaction_lines line ON line.department_id=t.department_id AND line.transaction_id=t.id
    JOIN finance_accounts a ON a.department_id=line.department_id AND a.id=line.account_id
    WHERE t.department_id=$1 AND line.cost_center_id=$2 AND t.accounting_year=$3 AND t.status='posted'
      AND t.booking_date BETWEEN $4::date AND $5::date GROUP BY a.id
  )
  SELECT b.id,a.code AS "accountCode",a.name AS "accountName",b.amount_cents::text AS "budgetCents",
    actual.value::text AS "actualCents",(b.amount_cents-actual.value)::text AS "remainingCents"
  FROM finance_budgets b LEFT JOIN finance_accounts a ON a.department_id=b.department_id AND a.id=b.account_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(sum(p.actual),0) AS value FROM actual_by_account p WHERE b.account_id IS NULL OR p.account_id=b.account_id
  ) actual
  WHERE b.department_id=$1 AND b.cost_center_id=$2 AND b.accounting_year=$3
  ORDER BY a.code NULLS FIRST,b.id LIMIT $6
`;
