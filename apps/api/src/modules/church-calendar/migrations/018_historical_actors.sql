-- Historical actors survive account deletion. Calendar access still uses live owner and member IDs.
CREATE OR REPLACE FUNCTION capture_church_calendar_historical_actor() RETURNS trigger
LANGUAGE plpgsql AS $calendar_actor$
DECLARE
  actor_id UUID;
  changed BOOLEAN := false;
BEGIN
  CASE TG_ARGV[0]
    WHEN 'created_by' THEN actor_id := NEW.created_by;
    WHEN 'updated_by' THEN actor_id := NEW.updated_by;
    WHEN 'uploaded_by' THEN actor_id := NEW.uploaded_by;
    WHEN 'actor_user_id' THEN actor_id := NEW.actor_user_id;
    WHEN 'invited_by' THEN actor_id := NEW.invited_by;
    ELSE RAISE EXCEPTION 'Unsupported Calendar actor field.';
  END CASE;
  IF actor_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    changed := NEW.historical_actor_id IS NULL;
  ELSE
    CASE TG_ARGV[0]
      WHEN 'created_by' THEN changed := actor_id IS DISTINCT FROM OLD.created_by;
      WHEN 'updated_by' THEN changed := actor_id IS DISTINCT FROM OLD.updated_by;
      WHEN 'uploaded_by' THEN changed := actor_id IS DISTINCT FROM OLD.uploaded_by;
      WHEN 'actor_user_id' THEN changed := actor_id IS DISTINCT FROM OLD.actor_user_id;
      WHEN 'invited_by' THEN changed := actor_id IS DISTINCT FROM OLD.invited_by;
    END CASE;
    CASE TG_ARGV[1]
      WHEN 'created_at' THEN changed := changed OR NEW.created_at IS DISTINCT FROM OLD.created_at;
      WHEN 'updated_at' THEN changed := changed OR NEW.updated_at IS DISTINCT FROM OLD.updated_at;
      WHEN 'invited_at' THEN changed := changed OR NEW.invited_at IS DISTINCT FROM OLD.invited_at;
      ELSE NULL;
    END CASE;
  END IF;
  IF changed THEN
    NEW.historical_actor_id := actor_id;
    SELECT display_name INTO NEW.historical_actor_name FROM app_users WHERE id=actor_id;
  END IF;
  RETURN NEW;
END
$calendar_actor$;

ALTER TABLE church_calendar_calendars
  ADD COLUMN IF NOT EXISTS historical_actor_id UUID,
  ADD COLUMN IF NOT EXISTS historical_actor_name TEXT;
UPDATE church_calendar_calendars entry
SET historical_actor_id=actor.id,historical_actor_name=actor.display_name
FROM app_users actor
WHERE entry.created_by=actor.id AND entry.historical_actor_id IS NULL;
ALTER TABLE church_calendar_calendars
  ALTER COLUMN created_by DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS church_calendar_calendars_created_by_fkey,
  ADD CONSTRAINT church_calendar_calendars_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_users(id) ON DELETE SET NULL,
  DROP CONSTRAINT IF EXISTS calendar_actor_attribution_check,
  ADD CONSTRAINT calendar_actor_attribution_check CHECK (created_by IS NOT NULL OR historical_actor_id IS NOT NULL);
DROP TRIGGER IF EXISTS calendar_history_actor ON church_calendar_calendars;
CREATE TRIGGER calendar_history_actor
  BEFORE INSERT OR UPDATE OF created_by ON church_calendar_calendars
  FOR EACH ROW EXECUTE FUNCTION capture_church_calendar_historical_actor('created_by','');

ALTER TABLE church_calendar_appointments
  ADD COLUMN IF NOT EXISTS historical_actor_id UUID,
  ADD COLUMN IF NOT EXISTS historical_actor_name TEXT;
UPDATE church_calendar_appointments entry
SET historical_actor_id=actor.id,historical_actor_name=actor.display_name
FROM app_users actor
WHERE entry.created_by=actor.id AND entry.historical_actor_id IS NULL;
ALTER TABLE church_calendar_appointments
  ALTER COLUMN created_by DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS church_calendar_appointments_created_by_fkey,
  ADD CONSTRAINT church_calendar_appointments_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_users(id) ON DELETE SET NULL,
  DROP CONSTRAINT IF EXISTS calendar_actor_attribution_check,
  ADD CONSTRAINT calendar_actor_attribution_check CHECK (created_by IS NOT NULL OR historical_actor_id IS NOT NULL);
DROP TRIGGER IF EXISTS calendar_history_actor ON church_calendar_appointments;
CREATE TRIGGER calendar_history_actor
  BEFORE INSERT OR UPDATE OF created_by ON church_calendar_appointments
  FOR EACH ROW EXECUTE FUNCTION capture_church_calendar_historical_actor('created_by','');

ALTER TABLE church_calendar_appointment_exceptions
  ADD COLUMN IF NOT EXISTS historical_actor_id UUID,
  ADD COLUMN IF NOT EXISTS historical_actor_name TEXT;
UPDATE church_calendar_appointment_exceptions entry
SET historical_actor_id=actor.id,historical_actor_name=actor.display_name
FROM app_users actor
WHERE entry.updated_by=actor.id AND entry.historical_actor_id IS NULL;
ALTER TABLE church_calendar_appointment_exceptions
  ALTER COLUMN updated_by DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS church_calendar_appointment_exceptions_updated_by_fkey,
  ADD CONSTRAINT church_calendar_appointment_exceptions_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES app_users(id) ON DELETE SET NULL,
  DROP CONSTRAINT IF EXISTS calendar_actor_attribution_check,
  ADD CONSTRAINT calendar_actor_attribution_check CHECK (updated_by IS NOT NULL OR historical_actor_id IS NOT NULL);
DROP TRIGGER IF EXISTS calendar_history_actor ON church_calendar_appointment_exceptions;
CREATE TRIGGER calendar_history_actor
  BEFORE INSERT OR UPDATE OF updated_by,updated_at ON church_calendar_appointment_exceptions
  FOR EACH ROW EXECUTE FUNCTION capture_church_calendar_historical_actor('updated_by','updated_at');

ALTER TABLE church_calendar_extra_dates
  ADD COLUMN IF NOT EXISTS historical_actor_id UUID,
  ADD COLUMN IF NOT EXISTS historical_actor_name TEXT;
UPDATE church_calendar_extra_dates entry
SET historical_actor_id=actor.id,historical_actor_name=actor.display_name
FROM app_users actor
WHERE entry.created_by=actor.id AND entry.historical_actor_id IS NULL;
ALTER TABLE church_calendar_extra_dates
  ALTER COLUMN created_by DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS church_calendar_extra_dates_created_by_fkey,
  ADD CONSTRAINT church_calendar_extra_dates_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_users(id) ON DELETE SET NULL,
  DROP CONSTRAINT IF EXISTS calendar_actor_attribution_check,
  ADD CONSTRAINT calendar_actor_attribution_check CHECK (created_by IS NOT NULL OR historical_actor_id IS NOT NULL);
DROP TRIGGER IF EXISTS calendar_history_actor ON church_calendar_extra_dates;
CREATE TRIGGER calendar_history_actor
  BEFORE INSERT OR UPDATE OF created_by ON church_calendar_extra_dates
  FOR EACH ROW EXECUTE FUNCTION capture_church_calendar_historical_actor('created_by','');

ALTER TABLE church_calendar_resource_links
  ADD COLUMN IF NOT EXISTS historical_actor_id UUID,
  ADD COLUMN IF NOT EXISTS historical_actor_name TEXT;
UPDATE church_calendar_resource_links entry
SET historical_actor_id=actor.id,historical_actor_name=actor.display_name
FROM app_users actor
WHERE entry.created_by=actor.id AND entry.historical_actor_id IS NULL;
ALTER TABLE church_calendar_resource_links
  ALTER COLUMN created_by DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS church_calendar_resource_links_created_by_fkey,
  ADD CONSTRAINT church_calendar_resource_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_users(id) ON DELETE SET NULL,
  DROP CONSTRAINT IF EXISTS calendar_actor_attribution_check,
  ADD CONSTRAINT calendar_actor_attribution_check CHECK (created_by IS NOT NULL OR historical_actor_id IS NOT NULL);
DROP TRIGGER IF EXISTS calendar_history_actor ON church_calendar_resource_links;
CREATE TRIGGER calendar_history_actor
  BEFORE INSERT OR UPDATE OF created_by ON church_calendar_resource_links
  FOR EACH ROW EXECUTE FUNCTION capture_church_calendar_historical_actor('created_by','');

ALTER TABLE church_calendar_appointment_images
  ADD COLUMN IF NOT EXISTS historical_actor_id UUID,
  ADD COLUMN IF NOT EXISTS historical_actor_name TEXT;
UPDATE church_calendar_appointment_images entry
SET historical_actor_id=actor.id,historical_actor_name=actor.display_name
FROM app_users actor
WHERE entry.uploaded_by=actor.id AND entry.historical_actor_id IS NULL;
ALTER TABLE church_calendar_appointment_images
  ALTER COLUMN uploaded_by DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS church_calendar_appointment_images_uploaded_by_fkey,
  ADD CONSTRAINT church_calendar_appointment_images_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES app_users(id) ON DELETE SET NULL,
  DROP CONSTRAINT IF EXISTS calendar_actor_attribution_check,
  ADD CONSTRAINT calendar_actor_attribution_check CHECK (uploaded_by IS NOT NULL OR historical_actor_id IS NOT NULL);
DROP TRIGGER IF EXISTS calendar_history_actor ON church_calendar_appointment_images;
CREATE TRIGGER calendar_history_actor
  BEFORE INSERT OR UPDATE OF uploaded_by,updated_at ON church_calendar_appointment_images
  FOR EACH ROW EXECUTE FUNCTION capture_church_calendar_historical_actor('uploaded_by','updated_at');

ALTER TABLE church_calendar_public_feeds
  ADD COLUMN IF NOT EXISTS historical_actor_id UUID,
  ADD COLUMN IF NOT EXISTS historical_actor_name TEXT;
UPDATE church_calendar_public_feeds entry
SET historical_actor_id=actor.id,historical_actor_name=actor.display_name
FROM app_users actor
WHERE entry.created_by=actor.id AND entry.historical_actor_id IS NULL;
ALTER TABLE church_calendar_public_feeds
  ALTER COLUMN created_by DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS church_calendar_public_feeds_created_by_fkey,
  ADD CONSTRAINT church_calendar_public_feeds_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_users(id) ON DELETE SET NULL,
  DROP CONSTRAINT IF EXISTS calendar_actor_attribution_check,
  ADD CONSTRAINT calendar_actor_attribution_check CHECK (created_by IS NOT NULL OR historical_actor_id IS NOT NULL);
DROP TRIGGER IF EXISTS calendar_history_actor ON church_calendar_public_feeds;
CREATE TRIGGER calendar_history_actor
  BEFORE INSERT OR UPDATE OF created_by,created_at ON church_calendar_public_feeds
  FOR EACH ROW EXECUTE FUNCTION capture_church_calendar_historical_actor('created_by','created_at');

ALTER TABLE church_calendar_event_generations
  ADD COLUMN IF NOT EXISTS historical_actor_id UUID,
  ADD COLUMN IF NOT EXISTS historical_actor_name TEXT;
UPDATE church_calendar_event_generations entry
SET historical_actor_id=actor.id,historical_actor_name=actor.display_name
FROM app_users actor
WHERE entry.actor_user_id=actor.id AND entry.historical_actor_id IS NULL;
DROP TRIGGER IF EXISTS calendar_history_actor ON church_calendar_event_generations;
CREATE TRIGGER calendar_history_actor
  BEFORE INSERT OR UPDATE OF actor_user_id ON church_calendar_event_generations
  FOR EACH ROW EXECUTE FUNCTION capture_church_calendar_historical_actor('actor_user_id','');

ALTER TABLE church_calendar_meeting_requests
  ADD COLUMN IF NOT EXISTS historical_actor_id UUID,
  ADD COLUMN IF NOT EXISTS historical_actor_name TEXT;
UPDATE church_calendar_meeting_requests entry
SET historical_actor_id=actor.id,historical_actor_name=actor.display_name
FROM app_users actor
WHERE entry.invited_by=actor.id AND entry.historical_actor_id IS NULL;
DROP TRIGGER IF EXISTS calendar_history_actor ON church_calendar_meeting_requests;
CREATE TRIGGER calendar_history_actor
  BEFORE INSERT OR UPDATE OF invited_by,invited_at ON church_calendar_meeting_requests
  FOR EACH ROW EXECUTE FUNCTION capture_church_calendar_historical_actor('invited_by','invited_at');

ALTER TABLE church_calendar_agenda_publications
  ADD COLUMN IF NOT EXISTS historical_actor_id UUID,
  ADD COLUMN IF NOT EXISTS historical_actor_name TEXT;
UPDATE church_calendar_agenda_publications entry
SET historical_actor_id=actor.id,historical_actor_name=actor.display_name
FROM app_users actor
WHERE entry.created_by=actor.id AND entry.historical_actor_id IS NULL;
DROP TRIGGER IF EXISTS calendar_history_actor ON church_calendar_agenda_publications;
CREATE TRIGGER calendar_history_actor
  BEFORE INSERT OR UPDATE OF created_by ON church_calendar_agenda_publications
  FOR EACH ROW EXECUTE FUNCTION capture_church_calendar_historical_actor('created_by','');
