CREATE TABLE IF NOT EXISTS church_calendar_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL,
  department_id UUID NOT NULL,
  user_id UUID NOT NULL,
  original_start TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  minutes_before INTEGER NOT NULL CHECK (minutes_before IN (5,15,30,60,1440)),
  next_check_at TIMESTAMPTZ NOT NULL,
  delivered_at TIMESTAMPTZ,
  UNIQUE (appointment_id,user_id,original_start),
  FOREIGN KEY (appointment_id,department_id) REFERENCES church_calendar_appointments(id,department_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id,department_id) REFERENCES department_memberships(user_id,department_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS church_calendar_reminders_due_idx
  ON church_calendar_reminders(department_id,next_check_at) WHERE delivered_at IS NULL;

CREATE OR REPLACE FUNCTION wake_church_calendar_reminders() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target_id UUID;
BEGIN
  IF TG_TABLE_NAME='departments' THEN
    UPDATE church_calendar_reminders SET next_check_at=LEAST(next_check_at,now())
     WHERE department_id=NEW.id AND delivered_at IS NULL;
    RETURN NULL;
  ELSIF TG_TABLE_NAME='church_calendar_appointments' THEN
    target_id := NEW.id;
  ELSIF TG_OP='DELETE' THEN
    target_id := OLD.appointment_id;
  ELSE
    target_id := NEW.appointment_id;
  END IF;
  UPDATE church_calendar_reminders SET next_check_at=LEAST(next_check_at,now())
   WHERE appointment_id=target_id AND delivered_at IS NULL;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS church_calendar_reminders_appointment ON church_calendar_appointments;
CREATE TRIGGER church_calendar_reminders_appointment
AFTER UPDATE OF starts_at,time_zone,recurrence,all_day,archived_at ON church_calendar_appointments
FOR EACH ROW EXECUTE FUNCTION wake_church_calendar_reminders();

DROP TRIGGER IF EXISTS church_calendar_reminders_exception ON church_calendar_appointment_exceptions;
CREATE TRIGGER church_calendar_reminders_exception
AFTER INSERT OR UPDATE OR DELETE ON church_calendar_appointment_exceptions
FOR EACH ROW EXECUTE FUNCTION wake_church_calendar_reminders();

DROP TRIGGER IF EXISTS church_calendar_reminders_extra_date ON church_calendar_extra_dates;
CREATE TRIGGER church_calendar_reminders_extra_date
AFTER INSERT OR UPDATE OR DELETE ON church_calendar_extra_dates
FOR EACH ROW EXECUTE FUNCTION wake_church_calendar_reminders();

DROP TRIGGER IF EXISTS church_calendar_reminders_location_zone ON departments;
CREATE TRIGGER church_calendar_reminders_location_zone
AFTER UPDATE OF time_zone ON departments
FOR EACH ROW WHEN (OLD.time_zone IS DISTINCT FROM NEW.time_zone) EXECUTE FUNCTION wake_church_calendar_reminders();
