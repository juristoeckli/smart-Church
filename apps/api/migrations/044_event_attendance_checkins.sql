CREATE TABLE IF NOT EXISTS event_attendance_checkins (
  event_id UUID NOT NULL REFERENCES service_events(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  first_time_visitor BOOLEAN NOT NULL DEFAULT false,
  follow_up_status TEXT NOT NULL DEFAULT 'not_needed' CHECK (follow_up_status IN ('not_needed', 'needed', 'done')),
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, contact_id)
);

ALTER TABLE event_attendance_checkins
  ADD COLUMN IF NOT EXISTS follow_up_status TEXT NOT NULL DEFAULT 'not_needed'
  CHECK (follow_up_status IN ('not_needed', 'needed', 'done'));

CREATE INDEX IF NOT EXISTS event_attendance_checkins_contact_idx
  ON event_attendance_checkins (contact_id, checked_in_at DESC);
