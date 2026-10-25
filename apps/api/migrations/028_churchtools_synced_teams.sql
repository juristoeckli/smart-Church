ALTER TABLE church_teams ADD COLUMN IF NOT EXISTS source_system TEXT;
ALTER TABLE church_teams ADD COLUMN IF NOT EXISTS source_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS church_teams_import_source_idx
  ON church_teams (department_id, source_system, source_id)
  WHERE source_system IS NOT NULL;
