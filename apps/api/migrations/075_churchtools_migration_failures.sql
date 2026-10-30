ALTER TABLE churchtools_migration_snapshots
  ADD COLUMN IF NOT EXISTS failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  ADD COLUMN IF NOT EXISTS failed_records JSONB NOT NULL DEFAULT '[]'::jsonb;
