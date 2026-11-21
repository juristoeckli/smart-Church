ALTER TABLE church_calendar_appointments
  ADD COLUMN IF NOT EXISTS responsible_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS church_calendar_appointments_responsible_idx
  ON church_calendar_appointments(department_id,responsible_contact_id)
  WHERE responsible_contact_id IS NOT NULL;
