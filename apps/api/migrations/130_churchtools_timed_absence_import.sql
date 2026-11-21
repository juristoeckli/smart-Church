ALTER TABLE event_volunteer_absence_import_consents
  ADD COLUMN IF NOT EXISTS allow_timed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS timed_zone TEXT;

ALTER TABLE event_volunteer_absence_import_consents ADD CONSTRAINT event_volunteer_absence_consent_timed_zone
  CHECK ((allow_timed AND timed_zone IS NOT NULL) OR (NOT allow_timed AND timed_zone IS NULL));

ALTER TABLE churchtools_migration_absence_receipts
  ADD COLUMN IF NOT EXISTS original_starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS original_ends_at TIMESTAMPTZ;

ALTER TABLE churchtools_migration_absence_receipts ADD CONSTRAINT churchtools_absence_receipts_clock_pair
  CHECK ((original_starts_at IS NULL AND original_ends_at IS NULL) OR
    (original_starts_at IS NOT NULL AND original_ends_at IS NOT NULL AND original_starts_at < original_ends_at));
