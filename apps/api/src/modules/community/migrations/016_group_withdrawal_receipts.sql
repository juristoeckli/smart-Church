ALTER TABLE group_join_requests
  ADD COLUMN IF NOT EXISTS withdrawal_hash TEXT CHECK (withdrawal_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ;

ALTER TABLE group_join_requests DROP CONSTRAINT IF EXISTS group_join_requests_status_check;
ALTER TABLE group_join_requests ADD CONSTRAINT group_join_requests_status_check
  CHECK (status IN ('pending','approved','declined','waitlisted','withdrawn'));

CREATE UNIQUE INDEX IF NOT EXISTS group_join_requests_withdrawal_hash_idx
  ON group_join_requests(withdrawal_hash) WHERE withdrawal_hash IS NOT NULL;
