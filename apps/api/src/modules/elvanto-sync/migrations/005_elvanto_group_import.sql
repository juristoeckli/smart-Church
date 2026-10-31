ALTER TABLE elvanto_sync_settings
  ADD COLUMN IF NOT EXISTS groups_import_page INTEGER NOT NULL DEFAULT 1 CHECK (groups_import_page >= 1),
  ADD COLUMN IF NOT EXISTS groups_import_total INTEGER,
  ADD COLUMN IF NOT EXISTS groups_import_created_count INTEGER NOT NULL DEFAULT 0 CHECK (groups_import_created_count >= 0),
  ADD COLUMN IF NOT EXISTS groups_import_updated_count INTEGER NOT NULL DEFAULT 0 CHECK (groups_import_updated_count >= 0),
  ADD COLUMN IF NOT EXISTS groups_import_skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (groups_import_skipped_count >= 0),
  ADD COLUMN IF NOT EXISTS groups_import_complete BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS groups_preview_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS groups_preview_scanned_count INTEGER NOT NULL DEFAULT 0 CHECK (groups_preview_scanned_count >= 0),
  ADD COLUMN IF NOT EXISTS groups_preview_total INTEGER,
  ADD COLUMN IF NOT EXISTS groups_preview_complete BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS groups_importing BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS groups_import_started_at TIMESTAMPTZ;
