CREATE OR REPLACE FUNCTION enforce_resource_scheduler_capacity() RETURNS trigger
LANGUAGE plpgsql AS $scheduler$
DECLARE
  available_units INTEGER;
  peak_units BIGINT;
BEGIN
  IF NEW.is_intake_request OR NEW.status NOT IN ('requested','approved') THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.department_id::text), hashtext(NEW.resource_id::text));
  SELECT COALESCE(settings.total_units,1) INTO available_units
    FROM bookable_resources resource
    LEFT JOIN resource_scheduler_settings settings ON settings.department_id=resource.department_id AND settings.resource_id=resource.id
   WHERE resource.department_id=NEW.department_id AND resource.id=NEW.resource_id;
  IF available_units IS NULL THEN RAISE EXCEPTION 'Resource not found in this location.' USING ERRCODE='23503'; END IF;

  WITH occupied AS (
    SELECT booking.starts_at - make_interval(mins => booking.lead_in_minutes) AS begins_at,
           booking.ends_at + make_interval(mins => booking.cleanup_minutes) AS finishes_at,
           booking.quantity
      FROM resource_bookings booking
     WHERE booking.department_id=NEW.department_id AND booking.resource_id=NEW.resource_id
       AND booking.status IN ('requested','approved') AND NOT booking.is_intake_request AND booking.id<>NEW.id
       AND booking.starts_at - make_interval(mins => booking.lead_in_minutes) < NEW.ends_at + make_interval(mins => NEW.cleanup_minutes)
       AND booking.ends_at + make_interval(mins => booking.cleanup_minutes) > NEW.starts_at - make_interval(mins => NEW.lead_in_minutes)
  ),
  points AS (
    SELECT NEW.starts_at - make_interval(mins => NEW.lead_in_minutes) AS point_at
    UNION
    SELECT begins_at FROM occupied
     WHERE begins_at >= NEW.starts_at - make_interval(mins => NEW.lead_in_minutes)
       AND begins_at < NEW.ends_at + make_interval(mins => NEW.cleanup_minutes)
  )
  SELECT COALESCE(max((SELECT COALESCE(sum(occupied.quantity),0) FROM occupied
                       WHERE occupied.begins_at<=points.point_at AND occupied.finishes_at>points.point_at)
                      + CASE WHEN points.point_at < NEW.ends_at + make_interval(mins => NEW.cleanup_minutes) THEN NEW.quantity ELSE 0 END),0)
    INTO peak_units FROM points;

  IF peak_units > available_units THEN
    RAISE EXCEPTION 'This booking conflicts with an existing reservation or exceeds resource availability.' USING ERRCODE='23P01';
  END IF;
  RETURN NEW;
END
$scheduler$;
