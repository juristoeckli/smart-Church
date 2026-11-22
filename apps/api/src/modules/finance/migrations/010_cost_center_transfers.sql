ALTER TABLE finance_transactions
  ADD COLUMN IF NOT EXISTS is_cost_center_transfer BOOLEAN NOT NULL DEFAULT false;
