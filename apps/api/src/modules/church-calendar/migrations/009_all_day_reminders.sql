ALTER TABLE church_calendar_reminders
  ALTER COLUMN minutes_before DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS clock_time TIME WITHOUT TIME ZONE,
  ADD COLUMN IF NOT EXISTS clock_time_zone TEXT;

ALTER TABLE church_calendar_reminders
  ADD CONSTRAINT church_calendar_reminders_schedule_check CHECK (
    (minutes_before IS NOT NULL AND clock_time IS NULL AND clock_time_zone IS NULL)
    OR (minutes_before IS NULL AND clock_time IS NOT NULL AND clock_time < TIME '24:00'
        AND EXTRACT(SECOND FROM clock_time)=0
        AND clock_time_zone IS NOT NULL AND clock_time_zone ~ '^[A-Za-z][A-Za-z0-9_+/-]{0,79}$')
  );
