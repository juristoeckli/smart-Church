ALTER TABLE event_registrations
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES app_users(id) ON DELETE SET NULL;

ALTER TABLE event_registrations
  DROP CONSTRAINT IF EXISTS event_registrations_status_check;

ALTER TABLE event_registrations
  ADD CONSTRAINT event_registrations_status_check
  CHECK (status IN ('registered', 'waitlisted', 'cancelled'));

DROP INDEX IF EXISTS event_registrations_event_email_idx;
CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_active_event_email_idx
  ON event_registrations (event_id, lower(email))
  WHERE status IN ('registered', 'waitlisted');
