ALTER TABLE elvanto_sync_settings
  ADD COLUMN IF NOT EXISTS songs_import_page INTEGER NOT NULL DEFAULT 1 CHECK (songs_import_page >= 1),
  ADD COLUMN IF NOT EXISTS songs_import_total INTEGER,
  ADD COLUMN IF NOT EXISTS songs_import_created_count INTEGER NOT NULL DEFAULT 0 CHECK (songs_import_created_count >= 0),
  ADD COLUMN IF NOT EXISTS songs_import_updated_count INTEGER NOT NULL DEFAULT 0 CHECK (songs_import_updated_count >= 0),
  ADD COLUMN IF NOT EXISTS songs_import_skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (songs_import_skipped_count >= 0),
  ADD COLUMN IF NOT EXISTS songs_import_complete BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS songs_preview_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS songs_preview_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS songs_preview_complete BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS songs_preview_count INTEGER NOT NULL DEFAULT 0 CHECK (songs_preview_count >= 0),
  ADD COLUMN IF NOT EXISTS songs_imported_count INTEGER NOT NULL DEFAULT 0 CHECK (songs_imported_count >= 0),
  ADD COLUMN IF NOT EXISTS songs_last_import_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS songs_importing BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS songs_import_started_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS elvanto_songs_import (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  song JSONB NOT NULL,
  arrangements JSONB NOT NULL DEFAULT '[]'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, source_id)
);

CREATE INDEX IF NOT EXISTS elvanto_songs_imported_at_idx
  ON elvanto_songs_import (department_id, imported_at DESC);
