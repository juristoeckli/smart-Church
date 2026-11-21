ALTER TABLE church_calendar_resource_links
  ADD COLUMN IF NOT EXISTS occurrence_start TIMESTAMP WITHOUT TIME ZONE;

CREATE INDEX IF NOT EXISTS church_calendar_resource_links_occurrence_idx
  ON church_calendar_resource_links(appointment_id, occurrence_start)
  WHERE occurrence_start IS NOT NULL;
