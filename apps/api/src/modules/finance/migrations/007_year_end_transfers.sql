-- A year-end transfer is the idempotency and audit anchor for closing and
-- opening journals. Transaction references may be null for genuinely empty
-- ledgers, where no zero-value journal can be posted.
CREATE TABLE IF NOT EXISTS finance_year_end_transfers (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  source_year SMALLINT NOT NULL,
  target_year SMALLINT NOT NULL,
  closing_equity_account_id UUID NOT NULL,
  closing_transaction_id UUID,
  opening_transaction_id UUID,
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id, source_year),
  CHECK (source_year BETWEEN 1900 AND 2199),
  CHECK (target_year = source_year + 1),
  FOREIGN KEY (department_id, source_year) REFERENCES finance_accounting_years(department_id, accounting_year),
  FOREIGN KEY (department_id, target_year) REFERENCES finance_accounting_years(department_id, accounting_year),
  FOREIGN KEY (department_id, closing_equity_account_id) REFERENCES finance_accounts(department_id, id),
  FOREIGN KEY (department_id, closing_transaction_id) REFERENCES finance_transactions(department_id, id),
  FOREIGN KEY (department_id, opening_transaction_id) REFERENCES finance_transactions(department_id, id),
  CHECK (closing_transaction_id IS NULL OR closing_transaction_id <> opening_transaction_id)
);

CREATE INDEX IF NOT EXISTS finance_year_end_transfers_target_idx
  ON finance_year_end_transfers(department_id, target_year);
