CREATE TABLE IF NOT EXISTS sync_redundancy_pull_offers (
  snapshot_id UUID PRIMARY KEY,
  source_department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  target_installation_id UUID NOT NULL,
  target_department_id UUID NOT NULL,
  source_epoch BIGINT NOT NULL CHECK (source_epoch > 0),
  source_digest TEXT NOT NULL CHECK (source_digest ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sync_redundancy_pull_offers_expiry_idx
  ON sync_redundancy_pull_offers(expires_at);
