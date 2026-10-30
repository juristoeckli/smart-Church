CREATE TABLE IF NOT EXISTS elvanto_people_sync_state (
  department_id UUID PRIMARY KEY REFERENCES departments(id) ON DELETE CASCADE,
  cursor_at TIMESTAMPTZ,
  preview_id UUID,
  preview_at TIMESTAMPTZ,
  preview_cursor_to TIMESTAMPTZ,
  encrypted_preview TEXT,
  preview_count INTEGER NOT NULL DEFAULT 0 CHECK (preview_count >= 0),
  preview_offset INTEGER NOT NULL DEFAULT 0 CHECK (preview_offset >= 0),
  created_count INTEGER NOT NULL DEFAULT 0 CHECK (created_count >= 0),
  updated_count INTEGER NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
  skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  complete BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS elvanto_people_sync_baselines (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  baseline_hash TEXT NOT NULL,
  remote_modified_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, source_id)
);

CREATE INDEX IF NOT EXISTS elvanto_people_sync_baselines_modified_idx
  ON elvanto_people_sync_baselines (department_id, remote_modified_at);

ALTER TABLE elvanto_sync_settings
  ADD COLUMN IF NOT EXISTS people_import_last_completed_at TIMESTAMPTZ;
