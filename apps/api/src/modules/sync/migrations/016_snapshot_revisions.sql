ALTER TABLE sync_site_redundancy
  ADD COLUMN IF NOT EXISTS snapshot_revision BIGINT NOT NULL DEFAULT 0 CHECK (snapshot_revision >= 0);

ALTER TABLE sync_site_redundancy_replicas
  ADD COLUMN IF NOT EXISTS source_snapshot_revision BIGINT NOT NULL DEFAULT 0 CHECK (source_snapshot_revision >= 0);

ALTER TABLE sync_redundancy_imports
  ADD COLUMN IF NOT EXISTS source_snapshot_revision BIGINT NOT NULL DEFAULT 0 CHECK (source_snapshot_revision >= 0);

ALTER TABLE sync_redundancy_pull_offers
  ADD COLUMN IF NOT EXISTS source_snapshot_revision BIGINT NOT NULL DEFAULT 0 CHECK (source_snapshot_revision >= 0);
