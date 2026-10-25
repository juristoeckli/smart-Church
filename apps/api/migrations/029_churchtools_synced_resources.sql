ALTER TABLE bookable_resources ADD COLUMN IF NOT EXISTS source_system TEXT;
ALTER TABLE bookable_resources ADD COLUMN IF NOT EXISTS source_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS bookable_resources_import_source_idx
  ON bookable_resources (department_id, source_system, source_id)
  WHERE source_system IS NOT NULL;
