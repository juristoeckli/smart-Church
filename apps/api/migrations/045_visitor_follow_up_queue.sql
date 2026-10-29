ALTER TABLE event_attendance_checkins
  ADD COLUMN IF NOT EXISTS assigned_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS follow_up_due_date DATE,
  ADD COLUMN IF NOT EXISTS follow_up_note TEXT NOT NULL DEFAULT '' CHECK (length(follow_up_note) <= 1000);

CREATE INDEX IF NOT EXISTS event_attendance_follow_up_idx
  ON event_attendance_checkins (follow_up_status, checked_in_at DESC)
  WHERE first_time_visitor = true;
