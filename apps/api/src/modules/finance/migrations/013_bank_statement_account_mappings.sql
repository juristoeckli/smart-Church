CREATE TABLE IF NOT EXISTS finance_bank_statement_account_mappings (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  source_digest CHAR(64) NOT NULL CHECK (source_digest ~ '^[0-9a-f]{64}$'),
  account_id UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id,source_digest),
  FOREIGN KEY (department_id,account_id) REFERENCES finance_accounts(department_id,id) ON DELETE CASCADE
);
