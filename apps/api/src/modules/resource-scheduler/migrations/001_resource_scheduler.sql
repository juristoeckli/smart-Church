ALTER TABLE resource_bookings
  ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 10000),
  ADD COLUMN IF NOT EXISTS lead_in_minutes INTEGER NOT NULL DEFAULT 0 CHECK (lead_in_minutes BETWEEN 0 AND 10080),
  ADD COLUMN IF NOT EXISTS cleanup_minutes INTEGER NOT NULL DEFAULT 0 CHECK (cleanup_minutes BETWEEN 0 AND 10080);

CREATE TABLE IF NOT EXISTS resource_scheduler_settings (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL REFERENCES bookable_resources(id) ON DELETE CASCADE,
  total_units INTEGER NOT NULL DEFAULT 1 CHECK (total_units BETWEEN 1 AND 10000),
  default_lead_in_minutes INTEGER NOT NULL DEFAULT 0 CHECK (default_lead_in_minutes BETWEEN 0 AND 10080),
  default_cleanup_minutes INTEGER NOT NULL DEFAULT 0 CHECK (default_cleanup_minutes BETWEEN 0 AND 10080),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, resource_id)
);

INSERT INTO resource_scheduler_settings(department_id,resource_id)
SELECT department_id,id FROM bookable_resources
ON CONFLICT(department_id,resource_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS resource_booking_series (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL REFERENCES bookable_resources(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL CHECK (length(trim(purpose)) BETWEEN 1 AND 240),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  recurrence JSONB NOT NULL DEFAULT '{"frequency":"once"}'::jsonb,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 10000),
  lead_in_minutes INTEGER NOT NULL DEFAULT 0 CHECK (lead_in_minutes BETWEEN 0 AND 10080),
  cleanup_minutes INTEGER NOT NULL DEFAULT 0 CHECK (cleanup_minutes BETWEEN 0 AND 10080),
  initial_status TEXT NOT NULL DEFAULT 'requested' CHECK (initial_status IN ('requested','approved')),
  linked_appointment_id UUID,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (jsonb_typeof(recurrence)='object')
);

CREATE TABLE IF NOT EXISTS resource_booking_series_occurrences (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  series_id UUID NOT NULL REFERENCES resource_booking_series(id) ON DELETE CASCADE,
  resource_booking_id UUID NOT NULL UNIQUE REFERENCES resource_bookings(id) ON DELETE CASCADE,
  occurrence_starts_at TIMESTAMPTZ NOT NULL,
  is_extra_date BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(series_id,occurrence_starts_at)
);

CREATE TABLE IF NOT EXISTS resource_booking_series_dates (
  series_id UUID NOT NULL REFERENCES resource_booking_series(id) ON DELETE CASCADE,
  occurrence_date DATE NOT NULL,
  date_type TEXT NOT NULL CHECK (date_type IN ('extra','excluded')),
  created_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(series_id,occurrence_date,date_type)
);

CREATE TABLE IF NOT EXISTS resource_scheduler_audit (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
  series_id UUID,
  booking_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resource_booking_series_schedule_idx
  ON resource_booking_series(department_id,resource_id,starts_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS resource_booking_occurrence_series_idx
  ON resource_booking_series_occurrences(department_id,series_id,occurrence_starts_at);
CREATE INDEX IF NOT EXISTS resource_scheduler_audit_department_idx
  ON resource_scheduler_audit(department_id,created_at DESC);

CREATE OR REPLACE FUNCTION enforce_resource_scheduler_capacity() RETURNS trigger
LANGUAGE plpgsql AS $scheduler$
DECLARE
  available_units INTEGER;
  peak_units BIGINT;
BEGIN
  IF NEW.status NOT IN ('requested','approved') THEN RETURN NEW; END IF;
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
       AND booking.status IN ('requested','approved') AND booking.id<>NEW.id
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

DROP TRIGGER IF EXISTS resource_scheduler_capacity_check ON resource_bookings;
CREATE TRIGGER resource_scheduler_capacity_check
BEFORE INSERT OR UPDATE OF department_id,resource_id,starts_at,ends_at,status,quantity,lead_in_minutes,cleanup_minutes
ON resource_bookings FOR EACH ROW EXECUTE FUNCTION enforce_resource_scheduler_capacity();
