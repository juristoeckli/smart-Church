CREATE UNIQUE INDEX IF NOT EXISTS finance_bank_statement_rows_department_id_idx
  ON finance_bank_statement_rows (department_id, id);

CREATE TABLE IF NOT EXISTS finance_bank_statement_suggestions (
  department_id UUID NOT NULL,
  row_id UUID NOT NULL,
  transaction_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, row_id),
  FOREIGN KEY (department_id, row_id) REFERENCES finance_bank_statement_rows(department_id, id) ON DELETE CASCADE,
  FOREIGN KEY (department_id, transaction_id) REFERENCES finance_transactions(department_id, id)
);
