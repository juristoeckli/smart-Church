ALTER TABLE elvanto_worship_song_import_previews
  ADD COLUMN IF NOT EXISTS skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0);
