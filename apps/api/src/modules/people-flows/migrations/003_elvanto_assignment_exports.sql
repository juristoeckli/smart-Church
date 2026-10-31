CREATE TABLE IF NOT EXISTS elvanto_people_flow_export_runs (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  source_flow_id TEXT NOT NULL,
  local_flow_id UUID NOT NULL,
  settings_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','running','complete','uncertain','expired')),
  preview_rows JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(preview_rows)='array'),
  preview_sample JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(preview_sample)='array'),
  cursor INTEGER NOT NULL DEFAULT 0 CHECK (cursor >= 0),
  added_count INTEGER NOT NULL DEFAULT 0 CHECK (added_count >= 0),
  existing_count INTEGER NOT NULL DEFAULT 0 CHECK (existing_count >= 0),
  skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  previewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS elvanto_people_flow_export_recent_idx
  ON elvanto_people_flow_export_runs(department_id, previewed_at DESC);
