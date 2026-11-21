CREATE TABLE IF NOT EXISTS finance_settings (
  department_id UUID PRIMARY KEY REFERENCES departments(id) ON DELETE CASCADE,
  currency_code CHAR(3) NOT NULL DEFAULT 'CHF' CHECK (currency_code ~ '^[A-Z]{3}$'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance_accounts (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(160) NOT NULL,
  account_type VARCHAR(16) NOT NULL CHECK (account_type IN ('asset','liability','equity','income','expense')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(department_id, code),
  UNIQUE(department_id, id)
);

CREATE TABLE IF NOT EXISTS finance_cost_centers (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(160) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(department_id, code),
  UNIQUE(department_id, id)
);

CREATE TABLE IF NOT EXISTS finance_donors (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  donor_type VARCHAR(12) NOT NULL CHECK (donor_type IN ('individual','joint')),
  display_name VARCHAR(180) NOT NULL,
  email VARCHAR(254) NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(department_id, id)
);

CREATE TABLE IF NOT EXISTS finance_transactions (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  booking_date DATE NOT NULL,
  accounting_year SMALLINT NOT NULL CHECK (accounting_year BETWEEN 1900 AND 2200),
  receipt_number VARCHAR(80) NOT NULL,
  booking_text VARCHAR(500) NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','draft')),
  reverses_transaction_id UUID,
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(department_id, id),
  UNIQUE(department_id, reverses_transaction_id),
  FOREIGN KEY (department_id, reverses_transaction_id) REFERENCES finance_transactions(department_id,id)
);

CREATE TABLE IF NOT EXISTS finance_transaction_lines (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL,
  line_number SMALLINT NOT NULL CHECK (line_number > 0),
  account_id UUID NOT NULL,
  cost_center_id UUID,
  donor_id UUID,
  debit_cents BIGINT NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
  credit_cents BIGINT NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  line_text VARCHAR(500) NOT NULL DEFAULT '',
  UNIQUE(department_id, transaction_id, line_number),
  FOREIGN KEY (department_id, transaction_id) REFERENCES finance_transactions(department_id,id) ON DELETE CASCADE,
  FOREIGN KEY (department_id, account_id) REFERENCES finance_accounts(department_id,id),
  FOREIGN KEY (department_id, cost_center_id) REFERENCES finance_cost_centers(department_id,id),
  FOREIGN KEY (department_id, donor_id) REFERENCES finance_donors(department_id,id),
  CHECK ((debit_cents > 0 AND credit_cents = 0) OR (credit_cents > 0 AND debit_cents = 0))
);

CREATE TABLE IF NOT EXISTS finance_budgets (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  accounting_year SMALLINT NOT NULL CHECK (accounting_year BETWEEN 1900 AND 2200),
  account_id UUID,
  cost_center_id UUID,
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  note VARCHAR(500) NOT NULL DEFAULT '',
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (account_id IS NOT NULL OR cost_center_id IS NOT NULL),
  FOREIGN KEY (department_id, account_id) REFERENCES finance_accounts(department_id,id),
  FOREIGN KEY (department_id, cost_center_id) REFERENCES finance_cost_centers(department_id,id)
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_budgets_scope_idx
  ON finance_budgets(department_id, accounting_year, COALESCE(account_id,'00000000-0000-0000-0000-000000000000'::UUID), COALESCE(cost_center_id,'00000000-0000-0000-0000-000000000000'::UUID));

CREATE TABLE IF NOT EXISTS finance_audit (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  action VARCHAR(48) NOT NULL,
  record_kind VARCHAR(32) NOT NULL,
  record_id UUID NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS finance_transactions_date_idx ON finance_transactions(department_id, booking_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS finance_lines_account_idx ON finance_transaction_lines(department_id, account_id, transaction_id);
CREATE INDEX IF NOT EXISTS finance_lines_cost_center_idx ON finance_transaction_lines(department_id, cost_center_id, transaction_id);
CREATE INDEX IF NOT EXISTS finance_donors_name_idx ON finance_donors(department_id, display_name);
CREATE INDEX IF NOT EXISTS finance_audit_record_idx ON finance_audit(department_id, record_kind, record_id, created_at DESC);

CREATE OR REPLACE FUNCTION finance_prevent_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM departments WHERE id=OLD.department_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Posted finance records are immutable; create a reversal instead.';
END;
$$;

DROP TRIGGER IF EXISTS finance_immutable_transaction ON finance_transactions;
CREATE TRIGGER finance_immutable_transaction BEFORE UPDATE OR DELETE ON finance_transactions
  FOR EACH ROW WHEN (OLD.status = 'posted') EXECUTE FUNCTION finance_prevent_ledger_mutation();

DROP TRIGGER IF EXISTS finance_immutable_transaction_line ON finance_transaction_lines;
CREATE TRIGGER finance_immutable_transaction_line BEFORE UPDATE OR DELETE ON finance_transaction_lines
  FOR EACH ROW EXECUTE FUNCTION finance_prevent_ledger_mutation();

CREATE OR REPLACE FUNCTION finance_enforce_balanced_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  transaction_key UUID;
  posting_status TEXT;
  posting_count INTEGER;
  debit_total NUMERIC;
  credit_total NUMERIC;
BEGIN
  IF TG_TABLE_NAME = 'finance_transactions' THEN
    transaction_key := NEW.id;
  ELSE
    transaction_key := NEW.transaction_id;
  END IF;
  SELECT status INTO posting_status FROM finance_transactions WHERE id=transaction_key AND department_id=NEW.department_id;
  IF posting_status <> 'posted' THEN RETURN NULL; END IF;
  SELECT count(*)::int,COALESCE(sum(debit_cents),0),COALESCE(sum(credit_cents),0)
    INTO posting_count,debit_total,credit_total
    FROM finance_transaction_lines WHERE department_id=NEW.department_id AND transaction_id=transaction_key;
  IF posting_count < 2 OR debit_total <= 0 OR debit_total <> credit_total THEN
    RAISE EXCEPTION 'A posted finance transaction must have at least two lines with equal positive debits and credits.';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS finance_balance_transaction_header ON finance_transactions;
CREATE CONSTRAINT TRIGGER finance_balance_transaction_header AFTER INSERT ON finance_transactions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_enforce_balanced_transaction();
DROP TRIGGER IF EXISTS finance_balance_transaction_line ON finance_transaction_lines;
CREATE CONSTRAINT TRIGGER finance_balance_transaction_line AFTER INSERT ON finance_transaction_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_enforce_balanced_transaction();

CREATE OR REPLACE FUNCTION finance_prevent_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Finance audit history is append-only.';
END;
$$;
DROP TRIGGER IF EXISTS finance_audit_append_only ON finance_audit;
CREATE TRIGGER finance_audit_append_only BEFORE UPDATE OR DELETE ON finance_audit
  FOR EACH ROW EXECUTE FUNCTION finance_prevent_audit_mutation();
