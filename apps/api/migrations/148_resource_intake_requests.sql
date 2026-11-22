ALTER TABLE bookable_resources ADD COLUMN IF NOT EXISTS intake_only boolean NOT NULL DEFAULT false
  CHECK (NOT intake_only OR NOT calendar_required);
ALTER TABLE resource_bookings ADD COLUMN IF NOT EXISTS is_intake_request boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION enforce_resource_intake_request() RETURNS trigger
LANGUAGE plpgsql AS $intake$
DECLARE intake boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.department_id::text),hashtext(NEW.resource_id::text));
  SELECT intake_only INTO intake FROM bookable_resources WHERE id=NEW.resource_id AND department_id=NEW.department_id;
  IF TG_OP='INSERT' THEN
    -- Preserve expired and terminal ordinary bookings during snapshot restore.
    IF NOT NEW.is_intake_request AND (NEW.ends_at<=now() OR NEW.status IN ('declined','cancelled')) THEN RETURN NEW; END IF;
    NEW.is_intake_request := COALESCE(intake,false) OR NEW.is_intake_request;
  ELSIF NEW.resource_id IS DISTINCT FROM OLD.resource_id OR NEW.department_id IS DISTINCT FROM OLD.department_id THEN
    NEW.is_intake_request := COALESCE(intake,false);
  ELSE
    NEW.is_intake_request := OLD.is_intake_request;
  END IF;
  IF NEW.status='approved' AND (NEW.is_intake_request OR COALESCE(intake,false)) THEN
    RAISE EXCEPTION 'Assign a specific resource before approving this request.' USING ERRCODE='23P01';
  END IF;
  RETURN NEW;
END
$intake$;

DROP TRIGGER IF EXISTS resource_booking_intake_guard ON resource_bookings;
CREATE TRIGGER resource_booking_intake_guard
BEFORE INSERT OR UPDATE OF department_id,resource_id,status,is_intake_request ON resource_bookings
FOR EACH ROW EXECUTE FUNCTION enforce_resource_intake_request();
