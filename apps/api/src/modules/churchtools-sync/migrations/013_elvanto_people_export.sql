ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS elvanto_source_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_department_elvanto_source_id_idx
  ON contacts (department_id, elvanto_source_id)
  WHERE elvanto_source_id IS NOT NULL;

ALTER TABLE elvanto_sync_settings
  ADD COLUMN IF NOT EXISTS people_export_preview_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS people_export_preview_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS people_export_page INTEGER NOT NULL DEFAULT 0 CHECK (people_export_page >= 0),
  ADD COLUMN IF NOT EXISTS people_export_created_count INTEGER NOT NULL DEFAULT 0 CHECK (people_export_created_count >= 0),
  ADD COLUMN IF NOT EXISTS people_export_updated_count INTEGER NOT NULL DEFAULT 0 CHECK (people_export_updated_count >= 0),
  ADD COLUMN IF NOT EXISTS people_export_skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (people_export_skipped_count >= 0),
  ADD COLUMN IF NOT EXISTS people_export_complete BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS people_exporting BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS people_export_started_at TIMESTAMPTZ;
