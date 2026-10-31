CREATE TABLE IF NOT EXISTS sync_site_redundancy_replicas (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  peer_installation_id UUID NOT NULL,
  peer_department_id UUID NOT NULL,
  last_snapshot_id UUID,
  source_digest TEXT CHECK (source_digest IS NULL OR source_digest ~ '^[0-9a-f]{64}$'),
  last_snapshot_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, peer_installation_id, peer_department_id)
);

ALTER TABLE sync_site_redundancy
  ADD COLUMN IF NOT EXISTS last_source_digest TEXT
    CHECK (last_source_digest IS NULL OR last_source_digest ~ '^[0-9a-f]{64}$');

CREATE INDEX IF NOT EXISTS sync_site_redundancy_replicas_status_idx
  ON sync_site_redundancy_replicas (department_id, last_snapshot_at DESC);
