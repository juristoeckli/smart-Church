ALTER TABLE elvanto_sync_settings
  ADD COLUMN IF NOT EXISTS financial_preview_fingerprints JSONB NOT NULL DEFAULT '{}'::jsonb;
