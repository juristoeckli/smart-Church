ALTER TABLE churchtools_migration_links
  DROP CONSTRAINT IF EXISTS churchtools_migration_links_area_check;

ALTER TABLE churchtools_migration_links
  ADD CONSTRAINT churchtools_migration_links_area_check
  CHECK (area IN ('person', 'group', 'event', 'resource', 'resource_booking'));

ALTER TABLE resource_bookings
  ALTER COLUMN requested_by DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS source_system TEXT,
  ADD COLUMN IF NOT EXISTS source_id TEXT,
  ADD COLUMN IF NOT EXISTS source_person_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS resource_bookings_import_source_idx
  ON resource_bookings (department_id, source_system, source_id)
  WHERE source_system IS NOT NULL;
