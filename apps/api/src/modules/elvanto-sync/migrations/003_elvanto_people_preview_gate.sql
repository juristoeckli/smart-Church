ALTER TABLE elvanto_sync_settings
  ADD COLUMN IF NOT EXISTS people_preview_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS people_preview_scanned_count INTEGER NOT NULL DEFAULT 0 CHECK (people_preview_scanned_count >= 0),
  ADD COLUMN IF NOT EXISTS people_preview_total INTEGER,
  ADD COLUMN IF NOT EXISTS people_preview_complete BOOLEAN NOT NULL DEFAULT FALSE;
