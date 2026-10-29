ALTER TABLE service_events
  ADD COLUMN IF NOT EXISTS recurrence_id UUID;

CREATE INDEX IF NOT EXISTS service_events_recurrence_idx ON service_events (department_id, recurrence_id, event_date) WHERE recurrence_id IS NOT NULL;
