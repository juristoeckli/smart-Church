ALTER TABLE event_volunteer_absences
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;

DO $$
DECLARE prior_name text;
BEGIN
  SELECT conname INTO prior_name FROM pg_constraint
   WHERE conrelid='event_volunteer_absences'::regclass AND contype='u'
     AND pg_get_constraintdef(oid)='UNIQUE (department_id, contact_id, starts_on, ends_on)';
  IF prior_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE event_volunteer_absences DROP CONSTRAINT %I', prior_name);
  END IF;
END
$$;

ALTER TABLE event_volunteer_absences ADD CONSTRAINT event_volunteer_absences_clock_pair
  CHECK ((starts_at IS NULL AND ends_at IS NULL) OR
    (starts_at IS NOT NULL AND ends_at IS NOT NULL AND starts_at < ends_at));

CREATE UNIQUE INDEX IF NOT EXISTS event_volunteer_absences_days_key
  ON event_volunteer_absences(department_id,contact_id,starts_on,ends_on) WHERE starts_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS event_volunteer_absences_times_key
  ON event_volunteer_absences(department_id,contact_id,starts_at,ends_at) WHERE starts_at IS NOT NULL;
