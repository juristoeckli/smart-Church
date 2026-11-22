ALTER TABLE resource_bookings
  ADD COLUMN IF NOT EXISTS requester_actor_id UUID,
  ADD COLUMN IF NOT EXISTS requester_actor_name TEXT;

UPDATE resource_bookings booking
SET requester_actor_id=actor.id, requester_actor_name=actor.display_name
FROM app_users actor
WHERE booking.requested_by=actor.id AND booking.requester_actor_id IS NULL;

ALTER TABLE resource_bookings
  ALTER COLUMN requested_by DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS resource_bookings_requested_by_fkey,
  ADD CONSTRAINT resource_bookings_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES app_users(id) ON DELETE SET NULL;

-- The immutable requester snapshot is attribution. Authorization uses only requested_by.
CREATE OR REPLACE FUNCTION capture_resource_requester_actor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.requested_by IS NOT NULL AND (
    (TG_OP='INSERT' AND NEW.requester_actor_id IS NULL) OR
    (TG_OP='UPDATE' AND NEW.requested_by IS DISTINCT FROM OLD.requested_by)
  ) THEN
    NEW.requester_actor_id := NEW.requested_by;
    SELECT display_name INTO NEW.requester_actor_name FROM app_users WHERE id=NEW.requested_by;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resource_booking_requester_actor ON resource_bookings;
CREATE TRIGGER resource_booking_requester_actor BEFORE INSERT OR UPDATE OF requested_by ON resource_bookings
  FOR EACH ROW EXECUTE FUNCTION capture_resource_requester_actor();

ALTER TABLE resource_bookings DROP CONSTRAINT IF EXISTS resource_bookings_requester_attribution_check;
ALTER TABLE resource_bookings ADD CONSTRAINT resource_bookings_requester_attribution_check
  CHECK (requested_by IS NOT NULL OR requester_actor_id IS NOT NULL);
