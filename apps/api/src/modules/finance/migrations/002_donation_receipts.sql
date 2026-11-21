CREATE TABLE IF NOT EXISTS finance_receipt_settings (
  department_id UUID PRIMARY KEY REFERENCES departments(id) ON DELETE CASCADE,
  organization_name VARCHAR(180) NOT NULL DEFAULT '',
  template_text TEXT NOT NULL DEFAULT E'Donation receipt for {{period}}\n\nReceived from: {{donorName}}\nAmount: {{currency}} {{amount}}\n\nThank you for your support.\n{{organization}}',
  numbering_prefix VARCHAR(24) NOT NULL DEFAULT 'DR',
  next_number BIGINT NOT NULL DEFAULT 1 CHECK (next_number > 0),
  updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance_receipt_batches (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  accounting_year SMALLINT NOT NULL CHECK (accounting_year BETWEEN 1900 AND 2200),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  collective BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(department_id, id),
  CHECK (period_end >= period_start)
);
CREATE UNIQUE INDEX IF NOT EXISTS finance_receipt_collective_batch_once_idx
  ON finance_receipt_batches(department_id, accounting_year, period_start, period_end) WHERE collective=true;

CREATE TABLE IF NOT EXISTS finance_donation_receipts (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL,
  donor_id UUID NOT NULL,
  receipt_number VARCHAR(80) NOT NULL,
  donor_name_snapshot VARCHAR(180) NOT NULL,
  donor_email_snapshot VARCHAR(254) NOT NULL DEFAULT '',
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  rendered_text TEXT NOT NULL,
  transaction_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(department_id, receipt_number),
  UNIQUE(department_id, batch_id, donor_id),
  UNIQUE(department_id, donor_id, period_start, period_end),
  FOREIGN KEY (department_id, batch_id) REFERENCES finance_receipt_batches(department_id,id) ON DELETE CASCADE,
  FOREIGN KEY (department_id, donor_id) REFERENCES finance_donors(department_id,id)
);

CREATE INDEX IF NOT EXISTS finance_receipts_donor_period_idx ON finance_donation_receipts(department_id, donor_id, period_start, period_end);

CREATE OR REPLACE FUNCTION finance_prevent_receipt_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Issued donation receipts are immutable.';
END;
$$;
DROP TRIGGER IF EXISTS finance_immutable_donation_receipt ON finance_donation_receipts;
CREATE TRIGGER finance_immutable_donation_receipt BEFORE UPDATE OR DELETE ON finance_donation_receipts
  FOR EACH ROW EXECUTE FUNCTION finance_prevent_receipt_mutation();
