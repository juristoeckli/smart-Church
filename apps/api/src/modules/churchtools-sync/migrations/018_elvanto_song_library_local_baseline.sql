ALTER TABLE elvanto_worship_song_links
  ADD COLUMN IF NOT EXISTS local_fingerprint TEXT;

ALTER TABLE elvanto_worship_song_import_previews
  ADD COLUMN IF NOT EXISTS updated_count INTEGER NOT NULL DEFAULT 0 CHECK (updated_count >= 0);
