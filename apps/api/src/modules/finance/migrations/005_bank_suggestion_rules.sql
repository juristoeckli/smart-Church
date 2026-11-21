CREATE TABLE IF NOT EXISTS finance_bank_suggestion_rules (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  account_id UUID NOT NULL,
  name VARCHAR(100) NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  statement_contains VARCHAR(120) NOT NULL CHECK (length(trim(statement_contains)) BETWEEN 1 AND 120),
  transaction_contains VARCHAR(120) NOT NULL CHECK (length(trim(transaction_contains)) BETWEEN 1 AND 120),
  priority SMALLINT NOT NULL DEFAULT 100 CHECK (priority BETWEEN 0 AND 1000),
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(department_id, id),
  UNIQUE(department_id, name),
  FOREIGN KEY(department_id, account_id) REFERENCES finance_accounts(department_id, id)
);

CREATE INDEX IF NOT EXISTS finance_bank_rules_active_idx
  ON finance_bank_suggestion_rules(department_id, account_id, priority DESC, created_at)
  WHERE active;
