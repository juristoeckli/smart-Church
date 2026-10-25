ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source_system TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE church_groups ADD COLUMN IF NOT EXISTS source_system TEXT;
ALTER TABLE church_groups ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE service_events ADD COLUMN IF NOT EXISTS source_system TEXT;
ALTER TABLE service_events ADD COLUMN IF NOT EXISTS source_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_import_source_idx ON contacts (department_id, source_system, source_id) WHERE source_system IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS church_groups_import_source_idx ON church_groups (department_id, source_system, source_id) WHERE source_system IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS service_events_import_source_idx ON service_events (department_id, source_system, source_id) WHERE source_system IS NOT NULL;

CREATE TABLE IF NOT EXISTS churchtools_sync_settings (
  department_id UUID PRIMARY KEY REFERENCES departments(id) ON DELETE CASCADE,
  instance_url TEXT NOT NULL,
  encrypted_login_token TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  last_sync_error TEXT,
  people_count INTEGER NOT NULL DEFAULT 0,
  group_count INTEGER NOT NULL DEFAULT 0,
  service_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
