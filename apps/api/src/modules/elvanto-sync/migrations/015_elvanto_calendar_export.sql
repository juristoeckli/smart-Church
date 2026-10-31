ALTER TABLE elvanto_sync_settings
  ADD COLUMN IF NOT EXISTS calendar_export_calendar_id TEXT,
  ADD COLUMN IF NOT EXISTS calendar_export_organizer_id TEXT,
  ADD COLUMN IF NOT EXISTS calendar_export_preview_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS calendar_export_preview_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS calendar_export_page INTEGER NOT NULL DEFAULT 0 CHECK (calendar_export_page >= 0),
  ADD COLUMN IF NOT EXISTS calendar_export_created_count INTEGER NOT NULL DEFAULT 0 CHECK (calendar_export_created_count >= 0),
  ADD COLUMN IF NOT EXISTS calendar_export_updated_count INTEGER NOT NULL DEFAULT 0 CHECK (calendar_export_updated_count >= 0),
  ADD COLUMN IF NOT EXISTS calendar_export_skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (calendar_export_skipped_count >= 0),
  ADD COLUMN IF NOT EXISTS calendar_export_complete BOOLEAN NOT NULL DEFAULT FALSE;
