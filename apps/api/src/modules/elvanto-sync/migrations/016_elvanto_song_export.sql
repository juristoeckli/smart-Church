CREATE TABLE IF NOT EXISTS elvanto_song_export_state (
  department_id UUID PRIMARY KEY REFERENCES departments(id) ON DELETE RESTRICT,
  preview_at TIMESTAMPTZ,
  preview_rows JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(preview_rows)='array'),
  page INTEGER NOT NULL DEFAULT 0 CHECK (page >= 0),
  created_count INTEGER NOT NULL DEFAULT 0 CHECK (created_count >= 0),
  updated_count INTEGER NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
  skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  complete BOOLEAN NOT NULL DEFAULT FALSE,
  exporting BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS elvanto_song_links (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  song_id UUID NOT NULL REFERENCES worship_songs(id) ON DELETE RESTRICT,
  source_id TEXT NOT NULL,
  local_hash TEXT NOT NULL,
  remote_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, song_id),
  UNIQUE (department_id, source_id)
);

CREATE TABLE IF NOT EXISTS elvanto_song_arrangement_links (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  song_id UUID NOT NULL REFERENCES worship_songs(id) ON DELETE RESTRICT,
  arrangement_id UUID NOT NULL REFERENCES worship_song_arrangements(id) ON DELETE RESTRICT,
  source_id TEXT NOT NULL,
  local_hash TEXT NOT NULL,
  remote_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, arrangement_id),
  UNIQUE (department_id, source_id)
);
