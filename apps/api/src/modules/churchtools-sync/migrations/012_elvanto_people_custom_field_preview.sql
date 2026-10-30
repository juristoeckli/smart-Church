ALTER TABLE elvanto_sync_settings
  ADD COLUMN IF NOT EXISTS people_preview_custom_fields JSONB NOT NULL DEFAULT '[]'::jsonb;
