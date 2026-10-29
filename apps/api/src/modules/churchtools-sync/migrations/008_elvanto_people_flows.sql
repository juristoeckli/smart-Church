ALTER TABLE elvanto_sync_settings
  ADD COLUMN IF NOT EXISTS people_flows_import_page INTEGER NOT NULL DEFAULT 1 CHECK (people_flows_import_page >= 1),
  ADD COLUMN IF NOT EXISTS people_flows_import_total INTEGER,
  ADD COLUMN IF NOT EXISTS people_flows_import_created_count INTEGER NOT NULL DEFAULT 0 CHECK (people_flows_import_created_count >= 0),
  ADD COLUMN IF NOT EXISTS people_flows_import_updated_count INTEGER NOT NULL DEFAULT 0 CHECK (people_flows_import_updated_count >= 0),
  ADD COLUMN IF NOT EXISTS people_flows_import_skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (people_flows_import_skipped_count >= 0),
  ADD COLUMN IF NOT EXISTS people_flows_import_complete BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS people_flows_preview_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS people_flows_preview_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS people_flows_preview_complete BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS people_flows_preview_count INTEGER NOT NULL DEFAULT 0 CHECK (people_flows_preview_count >= 0),
  ADD COLUMN IF NOT EXISTS people_flows_imported_count INTEGER NOT NULL DEFAULT 0 CHECK (people_flows_imported_count >= 0),
  ADD COLUMN IF NOT EXISTS people_flows_last_import_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS people_flows_importing BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS people_flows_import_started_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS elvanto_people_flows_import (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  definition JSONB NOT NULL,
  members JSONB NOT NULL DEFAULT '[]'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, source_id)
);

CREATE INDEX IF NOT EXISTS elvanto_people_flows_imported_at_idx
  ON elvanto_people_flows_import (department_id, imported_at DESC);
