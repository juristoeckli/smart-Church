CREATE TABLE IF NOT EXISTS church_calendar_agenda_publications (
  id uuid PRIMARY KEY,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  token_hash text NOT NULL UNIQUE,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (department_id,id)
);
CREATE INDEX IF NOT EXISTS calendar_agenda_active_location_idx
  ON church_calendar_agenda_publications(department_id,created_at,id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS church_calendar_agenda_calendars (
  department_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  calendar_id uuid NOT NULL,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 8),
  PRIMARY KEY (publication_id,calendar_id),
  UNIQUE (publication_id,position),
  FOREIGN KEY (department_id,publication_id) REFERENCES church_calendar_agenda_publications(department_id,id) ON DELETE CASCADE,
  FOREIGN KEY (department_id,calendar_id) REFERENCES church_calendar_calendars(department_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS calendar_agenda_calendars_source_idx ON church_calendar_agenda_calendars(department_id,calendar_id);

CREATE OR REPLACE FUNCTION drop_revoked_public_agenda_calendar() RETURNS trigger
LANGUAGE plpgsql AS $revoked$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM church_calendar_agenda_calendars WHERE department_id=OLD.department_id AND calendar_id=OLD.calendar_id;
  ELSIF NEW.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    DELETE FROM church_calendar_agenda_calendars WHERE department_id=NEW.department_id AND calendar_id=NEW.calendar_id;
  END IF;
  RETURN NULL;
END
$revoked$;

DROP TRIGGER IF EXISTS drop_revoked_agenda_calendar ON church_calendar_public_feeds;
CREATE TRIGGER drop_revoked_agenda_calendar
AFTER UPDATE OF revoked_at OR DELETE ON church_calendar_public_feeds
FOR EACH ROW EXECUTE FUNCTION drop_revoked_public_agenda_calendar();
