CREATE TABLE IF NOT EXISTS church_calendar_meeting_requests (
  appointment_id uuid NOT NULL REFERENCES church_calendar_appointments(id) ON DELETE CASCADE,
  original_start timestamp NOT NULL,
  recipient_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  notice_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  invited_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  scheduled_start timestamptz NOT NULL,
  scheduled_end timestamptz NOT NULL CHECK (scheduled_end > scheduled_start),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  invited_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  PRIMARY KEY (appointment_id,original_start,recipient_user_id)
);

CREATE OR REPLACE FUNCTION clear_stale_calendar_meeting_requests() RETURNS trigger
LANGUAGE plpgsql AS $request$
DECLARE
  parent_all_day boolean;
  default_end timestamp;
  previous jsonb;
  current jsonb;
  occurrence timestamp;
  appointment uuid;
  was_cancelled boolean;
  is_cancelled boolean;
BEGIN
  IF TG_TABLE_NAME = 'church_calendar_appointments' THEN
    IF ROW(OLD.starts_at,OLD.ends_at,OLD.all_day,OLD.time_zone,OLD.archived_at,OLD.calendar_id)
       IS DISTINCT FROM ROW(NEW.starts_at,NEW.ends_at,NEW.all_day,NEW.time_zone,NEW.archived_at,NEW.calendar_id) THEN
      DELETE FROM church_calendar_meeting_requests
       WHERE appointment_id=OLD.id;
    END IF;
  ELSIF TG_TABLE_NAME = 'church_calendar_appointment_exceptions' THEN
    IF TG_OP = 'UPDATE' AND (OLD.appointment_id,OLD.original_start) IS DISTINCT FROM (NEW.appointment_id,NEW.original_start) THEN
      DELETE FROM church_calendar_meeting_requests WHERE appointment_id=OLD.appointment_id AND original_start=OLD.original_start;
      RETURN NULL;
    END IF;
    IF TG_OP = 'INSERT' THEN
      appointment := NEW.appointment_id;
      occurrence := NEW.original_start;
      previous := '{}';
      current := NEW.overrides;
      was_cancelled := false;
      is_cancelled := NEW.cancelled;
    ELSIF TG_OP = 'DELETE' THEN
      appointment := OLD.appointment_id;
      occurrence := OLD.original_start;
      previous := OLD.overrides;
      current := '{}';
      was_cancelled := OLD.cancelled;
      is_cancelled := false;
    ELSE
      appointment := OLD.appointment_id;
      occurrence := OLD.original_start;
      previous := OLD.overrides;
      current := NEW.overrides;
      was_cancelled := OLD.cancelled;
      is_cancelled := NEW.cancelled;
    END IF;
    SELECT appointment_row.all_day,COALESCE(extra.ends_at,occurrence+ (appointment_row.ends_at-appointment_row.starts_at))
      INTO parent_all_day,default_end FROM church_calendar_appointments appointment_row
      LEFT JOIN church_calendar_extra_dates extra ON extra.appointment_id=appointment_row.id AND extra.starts_at=occurrence
     WHERE appointment_row.id=appointment;
    IF ROW(was_cancelled,COALESCE(replace(left(previous->>'startsAt',19),' ','T'),to_char(occurrence,'YYYY-MM-DD"T"HH24:MI:SS')),
           COALESCE(replace(left(previous->>'endsAt',19),' ','T'),to_char(default_end,'YYYY-MM-DD"T"HH24:MI:SS')),COALESCE(previous->>'allDay',parent_all_day::text))
       IS DISTINCT FROM
       ROW(is_cancelled,COALESCE(replace(left(current->>'startsAt',19),' ','T'),to_char(occurrence,'YYYY-MM-DD"T"HH24:MI:SS')),
           COALESCE(replace(left(current->>'endsAt',19),' ','T'),to_char(default_end,'YYYY-MM-DD"T"HH24:MI:SS')),COALESCE(current->>'allDay',parent_all_day::text)) THEN
      DELETE FROM church_calendar_meeting_requests WHERE appointment_id=appointment AND original_start=occurrence;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    DELETE FROM church_calendar_meeting_requests
     WHERE appointment_id=NEW.appointment_id AND original_start=NEW.starts_at;
  ELSIF TG_OP = 'DELETE' OR ROW(OLD.appointment_id,OLD.starts_at,OLD.ends_at)
       IS DISTINCT FROM ROW(NEW.appointment_id,NEW.starts_at,NEW.ends_at) THEN
    DELETE FROM church_calendar_meeting_requests
     WHERE appointment_id=OLD.appointment_id AND original_start=OLD.starts_at;
  END IF;
  RETURN NULL;
END
$request$;

DROP TRIGGER IF EXISTS calendar_meeting_requests_appointment_edit ON church_calendar_appointments;
CREATE TRIGGER calendar_meeting_requests_appointment_edit
AFTER UPDATE ON church_calendar_appointments
FOR EACH ROW EXECUTE FUNCTION clear_stale_calendar_meeting_requests();

DROP TRIGGER IF EXISTS calendar_meeting_requests_occurrence_edit ON church_calendar_appointment_exceptions;
CREATE TRIGGER calendar_meeting_requests_occurrence_edit
AFTER INSERT OR UPDATE OR DELETE ON church_calendar_appointment_exceptions
FOR EACH ROW EXECUTE FUNCTION clear_stale_calendar_meeting_requests();

DROP TRIGGER IF EXISTS calendar_meeting_requests_extra_date_edit ON church_calendar_extra_dates;
CREATE TRIGGER calendar_meeting_requests_extra_date_edit
AFTER INSERT OR UPDATE OR DELETE ON church_calendar_extra_dates
FOR EACH ROW EXECUTE FUNCTION clear_stale_calendar_meeting_requests();
