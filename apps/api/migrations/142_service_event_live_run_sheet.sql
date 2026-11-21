ALTER TABLE service_events ADD COLUMN IF NOT EXISTS live_run_sheet JSONB;

CREATE OR REPLACE FUNCTION reset_service_event_live_run_sheet()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.time_plan IS DISTINCT FROM OLD.time_plan
    OR NEW.source_system IS DISTINCT FROM OLD.source_system
    OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at THEN
    NEW.live_run_sheet := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS service_event_live_run_sheet_reset ON service_events;
CREATE TRIGGER service_event_live_run_sheet_reset
BEFORE UPDATE OF time_plan, source_system, cancelled_at ON service_events
FOR EACH ROW EXECUTE FUNCTION reset_service_event_live_run_sheet();
