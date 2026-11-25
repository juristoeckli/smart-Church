-- Account IDs remain distinct from retained attribution. Permissions use live IDs only.
CREATE OR REPLACE FUNCTION capture_people_record_actor() RETURNS trigger LANGUAGE plpgsql AS $people_history$
DECLARE
  actor_id UUID;
  actor_name TEXT;
  previous_id UUID;
  saved_id UUID;
  refresh_label BOOLEAN := false;
BEGIN
  CASE TG_ARGV[0]
    WHEN 'updated_by' THEN actor_id := NEW.updated_by; IF TG_OP = 'UPDATE' THEN previous_id := OLD.updated_by; END IF;
    WHEN 'created_by' THEN actor_id := NEW.created_by; IF TG_OP = 'UPDATE' THEN previous_id := OLD.created_by; END IF;
    WHEN 'actor_user_id' THEN actor_id := NEW.actor_user_id; IF TG_OP = 'UPDATE' THEN previous_id := OLD.actor_user_id; END IF;
    WHEN 'uploaded_by' THEN actor_id := NEW.uploaded_by; IF TG_OP = 'UPDATE' THEN previous_id := OLD.uploaded_by; END IF;
    WHEN 'edited_by' THEN actor_id := NEW.edited_by; IF TG_OP = 'UPDATE' THEN previous_id := OLD.edited_by; END IF;
    WHEN 'archived_by' THEN actor_id := NEW.archived_by; IF TG_OP = 'UPDATE' THEN previous_id := OLD.archived_by; END IF;
    ELSE RAISE EXCEPTION 'Unsupported People Records actor field.';
  END CASE;
  IF actor_id IS NULL THEN RETURN NEW; END IF;

  CASE TG_ARGV[1]
    WHEN 'created' THEN saved_id := NEW.created_actor_id;
    WHEN 'edited' THEN saved_id := NEW.edited_actor_id;
    WHEN 'archived' THEN saved_id := NEW.archived_actor_id;
    ELSE saved_id := NEW.historical_actor_id;
  END CASE;

  IF TG_OP = 'UPDATE' THEN
    CASE TG_ARGV[2]
      WHEN 'updated_at' THEN refresh_label := NEW.updated_at IS DISTINCT FROM OLD.updated_at;
      WHEN 'edited_at' THEN refresh_label := NEW.edited_at IS DISTINCT FROM OLD.edited_at;
      WHEN 'archived_at' THEN refresh_label := NEW.archived_at IS DISTINCT FROM OLD.archived_at;
      ELSE NULL;
    END CASE;
    IF actor_id IS NOT DISTINCT FROM previous_id AND NOT refresh_label THEN RETURN NEW; END IF;
  ELSIF saved_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO actor_name FROM app_users WHERE id=actor_id;
  CASE TG_ARGV[1]
    WHEN 'created' THEN NEW.created_actor_id := actor_id; NEW.created_actor_name := actor_name;
    WHEN 'edited' THEN NEW.edited_actor_id := actor_id; NEW.edited_actor_name := actor_name;
    WHEN 'archived' THEN NEW.archived_actor_id := actor_id; NEW.archived_actor_name := actor_name;
    ELSE NEW.historical_actor_id := actor_id; NEW.historical_actor_name := actor_name;
  END CASE;
  RETURN NEW;
END
$people_history$;

ALTER TABLE people_record_values
  ADD COLUMN IF NOT EXISTS historical_actor_id UUID,
  ADD COLUMN IF NOT EXISTS historical_actor_name TEXT;
UPDATE people_record_values entry
SET historical_actor_id=entry.updated_by,
    historical_actor_name=(SELECT display_name FROM app_users WHERE id=entry.updated_by)
WHERE entry.updated_by IS NOT NULL AND entry.historical_actor_id IS NULL;

DROP TRIGGER IF EXISTS people_record_historical_actor ON people_record_values;
CREATE TRIGGER people_record_historical_actor BEFORE INSERT OR UPDATE OF updated_by,updated_at ON people_record_values
  FOR EACH ROW EXECUTE FUNCTION capture_people_record_actor('updated_by','historical','updated_at');

ALTER TABLE people_record_relationships
  ADD COLUMN IF NOT EXISTS historical_actor_id UUID,
  ADD COLUMN IF NOT EXISTS historical_actor_name TEXT;
UPDATE people_record_relationships entry
SET historical_actor_id=entry.created_by,
    historical_actor_name=(SELECT display_name FROM app_users WHERE id=entry.created_by)
WHERE entry.created_by IS NOT NULL AND entry.historical_actor_id IS NULL;

DROP TRIGGER IF EXISTS people_record_historical_actor ON people_record_relationships;
CREATE TRIGGER people_record_historical_actor BEFORE INSERT OR UPDATE OF created_by ON people_record_relationships
  FOR EACH ROW EXECUTE FUNCTION capture_people_record_actor('created_by','historical','');

ALTER TABLE people_record_consents
  ADD COLUMN IF NOT EXISTS historical_actor_id UUID,
  ADD COLUMN IF NOT EXISTS historical_actor_name TEXT;
UPDATE people_record_consents entry
SET historical_actor_id=entry.actor_user_id,
    historical_actor_name=(SELECT display_name FROM app_users WHERE id=entry.actor_user_id)
WHERE entry.actor_user_id IS NOT NULL AND entry.historical_actor_id IS NULL;

DROP TRIGGER IF EXISTS people_record_historical_actor ON people_record_consents;
CREATE TRIGGER people_record_historical_actor BEFORE INSERT OR UPDATE OF actor_user_id ON people_record_consents
  FOR EACH ROW EXECUTE FUNCTION capture_people_record_actor('actor_user_id','historical','');

ALTER TABLE people_record_history
  ADD COLUMN IF NOT EXISTS historical_actor_id UUID,
  ADD COLUMN IF NOT EXISTS historical_actor_name TEXT;
UPDATE people_record_history entry
SET historical_actor_id=entry.actor_user_id,
    historical_actor_name=(SELECT display_name FROM app_users WHERE id=entry.actor_user_id)
WHERE entry.actor_user_id IS NOT NULL AND entry.historical_actor_id IS NULL;

DROP TRIGGER IF EXISTS people_record_historical_actor ON people_record_history;
CREATE TRIGGER people_record_historical_actor BEFORE INSERT OR UPDATE OF actor_user_id ON people_record_history
  FOR EACH ROW EXECUTE FUNCTION capture_people_record_actor('actor_user_id','historical','');

ALTER TABLE people_record_import_audits
  ADD COLUMN IF NOT EXISTS historical_actor_id UUID,
  ADD COLUMN IF NOT EXISTS historical_actor_name TEXT;
UPDATE people_record_import_audits entry
SET historical_actor_id=entry.actor_user_id,
    historical_actor_name=(SELECT display_name FROM app_users WHERE id=entry.actor_user_id)
WHERE entry.actor_user_id IS NOT NULL AND entry.historical_actor_id IS NULL;

DROP TRIGGER IF EXISTS people_record_historical_actor ON people_record_import_audits;
CREATE TRIGGER people_record_historical_actor BEFORE INSERT OR UPDATE OF actor_user_id ON people_record_import_audits
  FOR EACH ROW EXECUTE FUNCTION capture_people_record_actor('actor_user_id','historical','');

ALTER TABLE people_record_person_dates
  ADD COLUMN IF NOT EXISTS historical_actor_id UUID,
  ADD COLUMN IF NOT EXISTS historical_actor_name TEXT;
UPDATE people_record_person_dates entry
SET historical_actor_id=entry.updated_by,
    historical_actor_name=(SELECT display_name FROM app_users WHERE id=entry.updated_by)
WHERE entry.updated_by IS NOT NULL AND entry.historical_actor_id IS NULL;

DROP TRIGGER IF EXISTS people_record_historical_actor ON people_record_person_dates;
CREATE TRIGGER people_record_historical_actor BEFORE INSERT OR UPDATE OF updated_by,updated_at ON people_record_person_dates
  FOR EACH ROW EXECUTE FUNCTION capture_people_record_actor('updated_by','historical','updated_at');

ALTER TABLE people_record_merges
  ADD COLUMN IF NOT EXISTS historical_actor_id UUID,
  ADD COLUMN IF NOT EXISTS historical_actor_name TEXT;
UPDATE people_record_merges entry
SET historical_actor_id=entry.actor_user_id,
    historical_actor_name=(SELECT display_name FROM app_users WHERE id=entry.actor_user_id)
WHERE entry.actor_user_id IS NOT NULL AND entry.historical_actor_id IS NULL;

DROP TRIGGER IF EXISTS people_record_historical_actor ON people_record_merges;
CREATE TRIGGER people_record_historical_actor BEFORE INSERT OR UPDATE OF actor_user_id ON people_record_merges
  FOR EACH ROW EXECUTE FUNCTION capture_people_record_actor('actor_user_id','historical','');

ALTER TABLE people_record_relationship_types
  ADD COLUMN IF NOT EXISTS historical_actor_id UUID,
  ADD COLUMN IF NOT EXISTS historical_actor_name TEXT;
UPDATE people_record_relationship_types entry
SET historical_actor_id=entry.created_by,
    historical_actor_name=(SELECT display_name FROM app_users WHERE id=entry.created_by)
WHERE entry.created_by IS NOT NULL AND entry.historical_actor_id IS NULL;

DROP TRIGGER IF EXISTS people_record_historical_actor ON people_record_relationship_types;
CREATE TRIGGER people_record_historical_actor BEFORE INSERT OR UPDATE OF created_by ON people_record_relationship_types
  FOR EACH ROW EXECUTE FUNCTION capture_people_record_actor('created_by','historical','');

ALTER TABLE people_record_attachments
  ADD COLUMN IF NOT EXISTS historical_actor_id UUID,
  ADD COLUMN IF NOT EXISTS historical_actor_name TEXT;
UPDATE people_record_attachments entry
SET historical_actor_id=entry.uploaded_by,
    historical_actor_name=(SELECT display_name FROM app_users WHERE id=entry.uploaded_by)
WHERE entry.uploaded_by IS NOT NULL AND entry.historical_actor_id IS NULL;

DROP TRIGGER IF EXISTS people_record_historical_actor ON people_record_attachments;
CREATE TRIGGER people_record_historical_actor BEFORE INSERT OR UPDATE OF uploaded_by ON people_record_attachments
  FOR EACH ROW EXECUTE FUNCTION capture_people_record_actor('uploaded_by','historical','');

ALTER TABLE people_record_private_notes
  ADD COLUMN IF NOT EXISTS created_actor_id UUID,
  ADD COLUMN IF NOT EXISTS created_actor_name TEXT;
UPDATE people_record_private_notes entry
SET created_actor_id=entry.created_by,
    created_actor_name=(SELECT display_name FROM app_users WHERE id=entry.created_by)
WHERE entry.created_by IS NOT NULL AND entry.created_actor_id IS NULL;

DROP TRIGGER IF EXISTS people_record_created_actor ON people_record_private_notes;
CREATE TRIGGER people_record_created_actor BEFORE INSERT OR UPDATE OF created_by ON people_record_private_notes
  FOR EACH ROW EXECUTE FUNCTION capture_people_record_actor('created_by','created','');

ALTER TABLE people_record_private_notes
  ADD COLUMN IF NOT EXISTS edited_actor_id UUID,
  ADD COLUMN IF NOT EXISTS edited_actor_name TEXT;
UPDATE people_record_private_notes entry
SET edited_actor_id=entry.edited_by,
    edited_actor_name=(SELECT display_name FROM app_users WHERE id=entry.edited_by)
WHERE entry.edited_by IS NOT NULL AND entry.edited_actor_id IS NULL;

DROP TRIGGER IF EXISTS people_record_edited_actor ON people_record_private_notes;
CREATE TRIGGER people_record_edited_actor BEFORE INSERT OR UPDATE OF edited_by,edited_at ON people_record_private_notes
  FOR EACH ROW EXECUTE FUNCTION capture_people_record_actor('edited_by','edited','edited_at');

ALTER TABLE people_record_private_notes
  ADD COLUMN IF NOT EXISTS archived_actor_id UUID,
  ADD COLUMN IF NOT EXISTS archived_actor_name TEXT;
UPDATE people_record_private_notes entry
SET archived_actor_id=entry.archived_by,
    archived_actor_name=(SELECT display_name FROM app_users WHERE id=entry.archived_by)
WHERE entry.archived_by IS NOT NULL AND entry.archived_actor_id IS NULL;

DROP TRIGGER IF EXISTS people_record_archived_actor ON people_record_private_notes;
CREATE TRIGGER people_record_archived_actor BEFORE INSERT OR UPDATE OF archived_by,archived_at ON people_record_private_notes
  FOR EACH ROW EXECUTE FUNCTION capture_people_record_actor('archived_by','archived','archived_at');
