ALTER TABLE elvanto_sync_settings
  ADD COLUMN IF NOT EXISTS people_importing BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS people_import_started_at TIMESTAMPTZ;
