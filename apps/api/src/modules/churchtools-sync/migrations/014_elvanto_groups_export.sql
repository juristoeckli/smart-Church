ALTER TABLE church_groups
  ADD COLUMN IF NOT EXISTS elvanto_source_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS church_groups_department_elvanto_source_id_idx
  ON church_groups (department_id, elvanto_source_id)
  WHERE elvanto_source_id IS NOT NULL;

ALTER TABLE elvanto_sync_settings
  ADD COLUMN IF NOT EXISTS groups_export_preview_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS groups_export_preview_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS groups_export_page INTEGER NOT NULL DEFAULT 0 CHECK (groups_export_page >= 0),
  ADD COLUMN IF NOT EXISTS groups_export_created_count INTEGER NOT NULL DEFAULT 0 CHECK (groups_export_created_count >= 0),
  ADD COLUMN IF NOT EXISTS groups_export_updated_count INTEGER NOT NULL DEFAULT 0 CHECK (groups_export_updated_count >= 0),
  ADD COLUMN IF NOT EXISTS groups_export_added_members_count INTEGER NOT NULL DEFAULT 0 CHECK (groups_export_added_members_count >= 0),
  ADD COLUMN IF NOT EXISTS groups_export_skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (groups_export_skipped_count >= 0),
  ADD COLUMN IF NOT EXISTS groups_export_complete BOOLEAN NOT NULL DEFAULT FALSE;
