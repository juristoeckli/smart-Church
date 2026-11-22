ALTER TABLE resource_booking_series
  ADD COLUMN IF NOT EXISTS requester_actor_id UUID,
  ADD COLUMN IF NOT EXISTS requester_actor_name TEXT;

UPDATE resource_booking_series item
SET requester_actor_id=actor.id, requester_actor_name=actor.display_name
FROM app_users actor
WHERE item.requested_by=actor.id AND item.requester_actor_id IS NULL;

ALTER TABLE resource_booking_series
  ALTER COLUMN requested_by DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS resource_booking_series_requested_by_fkey,
  ADD CONSTRAINT resource_booking_series_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES app_users(id) ON DELETE SET NULL;


ALTER TABLE resource_booking_series_dates
  ADD COLUMN IF NOT EXISTS creator_actor_id UUID,
  ADD COLUMN IF NOT EXISTS creator_actor_name TEXT;

UPDATE resource_booking_series_dates item
SET creator_actor_id=actor.id, creator_actor_name=actor.display_name
FROM app_users actor
WHERE item.created_by=actor.id AND item.creator_actor_id IS NULL;

ALTER TABLE resource_booking_series_dates
  ALTER COLUMN created_by DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS resource_booking_series_dates_created_by_fkey,
  ADD CONSTRAINT resource_booking_series_dates_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_users(id) ON DELETE SET NULL;


ALTER TABLE resource_booking_series_occurrence_overrides
  ADD COLUMN IF NOT EXISTS editor_actor_id UUID,
  ADD COLUMN IF NOT EXISTS editor_actor_name TEXT;

UPDATE resource_booking_series_occurrence_overrides item
SET editor_actor_id=actor.id, editor_actor_name=actor.display_name
FROM app_users actor
WHERE item.updated_by=actor.id AND item.editor_actor_id IS NULL;

ALTER TABLE resource_booking_series_occurrence_overrides
  ALTER COLUMN updated_by DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS resource_booking_series_occurrence_overrides_updated_by_fkey,
  ADD CONSTRAINT resource_booking_series_occurrence_overrides_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES app_users(id) ON DELETE SET NULL;


ALTER TABLE resource_scheduler_audit
  ADD COLUMN IF NOT EXISTS historical_actor_id UUID,
  ADD COLUMN IF NOT EXISTS historical_actor_name TEXT;

UPDATE resource_scheduler_audit item
SET historical_actor_id=actor.id, historical_actor_name=actor.display_name
FROM app_users actor
WHERE item.actor_user_id=actor.id AND item.historical_actor_id IS NULL;

DROP TRIGGER IF EXISTS resource_series_requester_actor ON resource_booking_series;
CREATE TRIGGER resource_series_requester_actor BEFORE INSERT OR UPDATE OF requested_by ON resource_booking_series
  FOR EACH ROW EXECUTE FUNCTION capture_resource_requester_actor();

CREATE OR REPLACE FUNCTION capture_scheduler_history_actor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='resource_booking_series_dates' THEN
    IF NEW.creator_actor_id IS NULL AND NEW.created_by IS NOT NULL THEN
      NEW.creator_actor_id := NEW.created_by;
      SELECT display_name INTO NEW.creator_actor_name FROM app_users WHERE id=NEW.created_by;
    END IF;
  ELSIF TG_TABLE_NAME='resource_booking_series_occurrence_overrides' THEN
    IF NEW.updated_by IS NOT NULL AND (
      (TG_OP='INSERT' AND NEW.editor_actor_id IS NULL) OR
      (TG_OP='UPDATE' AND (NEW.updated_by IS DISTINCT FROM OLD.updated_by OR NEW.updated_at IS DISTINCT FROM OLD.updated_at))
    ) THEN
      NEW.editor_actor_id := NEW.updated_by;
      SELECT display_name INTO NEW.editor_actor_name FROM app_users WHERE id=NEW.updated_by;
    END IF;
  ELSIF TG_TABLE_NAME='resource_scheduler_audit' THEN
    IF NEW.historical_actor_id IS NULL AND NEW.actor_user_id IS NOT NULL THEN
      NEW.historical_actor_id := NEW.actor_user_id;
      SELECT display_name INTO NEW.historical_actor_name FROM app_users WHERE id=NEW.actor_user_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resource_series_date_creator_actor ON resource_booking_series_dates;
CREATE TRIGGER resource_series_date_creator_actor BEFORE INSERT ON resource_booking_series_dates
  FOR EACH ROW EXECUTE FUNCTION capture_scheduler_history_actor();
DROP TRIGGER IF EXISTS resource_override_editor_actor ON resource_booking_series_occurrence_overrides;
CREATE TRIGGER resource_override_editor_actor BEFORE INSERT OR UPDATE OF updated_by,updated_at ON resource_booking_series_occurrence_overrides
  FOR EACH ROW EXECUTE FUNCTION capture_scheduler_history_actor();
DROP TRIGGER IF EXISTS resource_audit_historical_actor ON resource_scheduler_audit;
CREATE TRIGGER resource_audit_historical_actor BEFORE INSERT ON resource_scheduler_audit
  FOR EACH ROW EXECUTE FUNCTION capture_scheduler_history_actor();

ALTER TABLE resource_booking_series DROP CONSTRAINT IF EXISTS resource_series_requester_attribution;
ALTER TABLE resource_booking_series ADD CONSTRAINT resource_series_requester_attribution
  CHECK (requested_by IS NOT NULL OR requester_actor_id IS NOT NULL);
ALTER TABLE resource_booking_series_dates DROP CONSTRAINT IF EXISTS resource_date_creator_attribution;
ALTER TABLE resource_booking_series_dates ADD CONSTRAINT resource_date_creator_attribution
  CHECK (created_by IS NOT NULL OR creator_actor_id IS NOT NULL);
ALTER TABLE resource_booking_series_occurrence_overrides DROP CONSTRAINT IF EXISTS resource_override_editor_attribution;
ALTER TABLE resource_booking_series_occurrence_overrides ADD CONSTRAINT resource_override_editor_attribution
  CHECK (updated_by IS NOT NULL OR editor_actor_id IS NOT NULL);
