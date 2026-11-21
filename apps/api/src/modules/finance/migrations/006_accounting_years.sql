CREATE TABLE IF NOT EXISTS finance_accounting_years (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  accounting_year SMALLINT NOT NULL CHECK (accounting_year BETWEEN 1900 AND 2200),
  label VARCHAR(120) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(8) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, accounting_year),
  CHECK (start_date <= end_date)
);

-- Preserve existing year-based ledger/report behavior by creating an open
-- calendar period for every year already referenced, plus the current year.
INSERT INTO finance_accounting_years(department_id, accounting_year, label, start_date, end_date, status)
SELECT source.department_id, source.accounting_year, source.accounting_year::text,
       make_date(source.accounting_year::int, 1, 1), make_date(source.accounting_year::int, 12, 31), 'open'
  FROM (
    SELECT department_id, accounting_year FROM finance_transactions
    UNION SELECT department_id, accounting_year FROM finance_budgets
    UNION SELECT department_id, accounting_year FROM finance_receipt_batches
    UNION SELECT id, extract(year FROM current_date)::smallint FROM departments
  ) AS source
ON CONFLICT(department_id, accounting_year) DO NOTHING;
