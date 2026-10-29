ALTER TABLE elvanto_sync_settings
  ADD COLUMN IF NOT EXISTS people_import_page INTEGER NOT NULL DEFAULT 1 CHECK (people_import_page >= 1),
  ADD COLUMN IF NOT EXISTS people_import_total INTEGER,
  ADD COLUMN IF NOT EXISTS people_import_created_count INTEGER NOT NULL DEFAULT 0 CHECK (people_import_created_count >= 0),
  ADD COLUMN IF NOT EXISTS people_import_updated_count INTEGER NOT NULL DEFAULT 0 CHECK (people_import_updated_count >= 0),
  ADD COLUMN IF NOT EXISTS people_import_skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (people_import_skipped_count >= 0),
  ADD COLUMN IF NOT EXISTS people_import_complete BOOLEAN NOT NULL DEFAULT FALSE;
