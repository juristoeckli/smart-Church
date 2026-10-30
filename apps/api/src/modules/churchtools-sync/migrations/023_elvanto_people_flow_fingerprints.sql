ALTER TABLE elvanto_sync_settings
  ADD COLUMN IF NOT EXISTS people_flows_preview_fingerprints JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(people_flows_preview_fingerprints)='object');
