ALTER TABLE group_meetings
  ADD COLUMN calendar_appointment_id UUID,
  ADD COLUMN calendar_occurrence_key TEXT,
  ADD CONSTRAINT group_meetings_calendar_source_check CHECK (
    (calendar_appointment_id IS NULL AND calendar_occurrence_key IS NULL)
    OR (calendar_appointment_id IS NOT NULL AND calendar_occurrence_key IS NOT NULL)
  );

-- Preserve manual meeting deduplication and distinguish separate Calendar occurrences.
CREATE UNIQUE INDEX group_meetings_manual_identity
  ON group_meetings (group_id, meeting_date, title) WHERE calendar_appointment_id IS NULL;
CREATE UNIQUE INDEX group_meetings_calendar_identity
  ON group_meetings (department_id, group_id, calendar_appointment_id, calendar_occurrence_key)
  WHERE calendar_appointment_id IS NOT NULL;
ALTER TABLE group_meetings DROP CONSTRAINT group_meetings_group_id_meeting_date_title_key;
