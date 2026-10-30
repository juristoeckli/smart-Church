ALTER TABLE eventdesk_customers
  ADD COLUMN IF NOT EXISTS default_discount_bps INTEGER NOT NULL DEFAULT 0
  CHECK (default_discount_bps BETWEEN 0 AND 10000);

ALTER TABLE eventdesk_jobs
  ADD COLUMN IF NOT EXISTS discount_bps INTEGER NOT NULL DEFAULT 0
  CHECK (discount_bps BETWEEN 0 AND 10000);
