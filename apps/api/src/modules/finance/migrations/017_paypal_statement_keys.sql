CREATE TABLE IF NOT EXISTS finance_paypal_statement_keys (
  department_id UUID NOT NULL,
  fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  row_id UUID NOT NULL,
  gross_cents BIGINT NOT NULL,
  fee_cents BIGINT NOT NULL,
  currency_code TEXT NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  PRIMARY KEY (department_id, fingerprint),
  UNIQUE (department_id, row_id),
  FOREIGN KEY (department_id, row_id) REFERENCES finance_bank_statement_rows(department_id, id) ON DELETE CASCADE
);
