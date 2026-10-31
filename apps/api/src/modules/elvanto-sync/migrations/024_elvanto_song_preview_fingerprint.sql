ALTER TABLE elvanto_sync_settings
  ADD COLUMN IF NOT EXISTS songs_preview_fingerprint TEXT;
