CREATE TABLE IF NOT EXISTS elvanto_worship_song_links (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  source_song_id TEXT NOT NULL,
  song_id UUID NOT NULL UNIQUE REFERENCES worship_songs(id) ON DELETE RESTRICT,
  source_fingerprint TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, source_song_id)
);
CREATE TABLE IF NOT EXISTS elvanto_worship_arrangement_links (
  department_id UUID NOT NULL,
  source_song_id TEXT NOT NULL,
  source_arrangement_id TEXT NOT NULL,
  source_key_id TEXT NOT NULL,
  arrangement_id UUID NOT NULL UNIQUE REFERENCES worship_song_arrangements(id) ON DELETE RESTRICT,
  PRIMARY KEY (department_id, source_song_id, source_arrangement_id, source_key_id),
  FOREIGN KEY (department_id, source_song_id)
    REFERENCES elvanto_worship_song_links(department_id, source_song_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS elvanto_worship_song_import_previews (
  department_id UUID PRIMARY KEY REFERENCES departments(id) ON DELETE CASCADE,
  preview_id UUID NOT NULL,
  rows JSONB NOT NULL CHECK (jsonb_typeof(rows) = 'array'),
  cursor INTEGER NOT NULL DEFAULT 0 CHECK (cursor >= 0),
  created_count INTEGER NOT NULL DEFAULT 0 CHECK (created_count >= 0),
  review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
