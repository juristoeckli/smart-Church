ALTER TABLE church_calendar_appointments
  ADD COLUMN IF NOT EXISTS signup_group_id UUID REFERENCES church_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS church_calendar_appointments_signup_group_idx
  ON church_calendar_appointments(department_id,signup_group_id)
  WHERE signup_group_id IS NOT NULL;
