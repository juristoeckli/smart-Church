ALTER TABLE service_events ADD COLUMN IF NOT EXISTS shared_agenda_source_id UUID;
ALTER TABLE service_events DROP CONSTRAINT IF EXISTS service_events_shared_agenda_source_fk;
ALTER TABLE service_events ADD CONSTRAINT service_events_shared_agenda_source_fk
  FOREIGN KEY (department_id, shared_agenda_source_id) REFERENCES service_events(department_id, id)
  ON DELETE SET NULL (shared_agenda_source_id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS service_events_shared_agenda_source ON service_events (shared_agenda_source_id) WHERE shared_agenda_source_id IS NOT NULL;

CREATE OR REPLACE FUNCTION shared_event_agenda_plan(plan JSONB, offset_minutes INTEGER)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'title', item->'title',
    'section', item->'section',
    'durationMinutes', item->'durationMinutes',
    'songId', item->'songId',
    'arrangementId', item->'arrangementId',
    'startTime', CASE WHEN item->>'startTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      THEN to_char(date '2000-01-01' + (item->>'startTime')::time + make_interval(mins => offset_minutes), 'HH24:MI') END
  )) ORDER BY ordinal), '[]'::jsonb)
  FROM jsonb_array_elements(plan) WITH ORDINALITY AS entries(item, ordinal)
$$;

CREATE OR REPLACE FUNCTION synchronize_shared_event_agenda()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cancelled_at IS NOT NULL OR NEW.source_system IS NOT NULL
    OR NEW.event_date IS DISTINCT FROM OLD.event_date OR NEW.start_time IS DISTINCT FROM OLD.start_time
    OR NEW.is_all_day IS DISTINCT FROM OLD.is_all_day THEN
    UPDATE service_events SET shared_agenda_source_id=NULL
      WHERE shared_agenda_source_id=NEW.id AND department_id=NEW.department_id;
    IF NEW.shared_agenda_source_id IS NOT NULL THEN
      UPDATE service_events SET shared_agenda_source_id=NULL WHERE id=NEW.id;
    END IF;
  ELSIF NEW.time_plan IS DISTINCT FROM OLD.time_plan AND NEW.shared_agenda_source_id IS NULL THEN
    UPDATE service_events SET time_plan=shared_event_agenda_plan(NEW.time_plan,
      (extract(epoch FROM (service_events.start_time - NEW.start_time)) / 60)::integer)
      WHERE shared_agenda_source_id=NEW.id AND department_id=NEW.department_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS service_event_shared_agenda_sync ON service_events;
CREATE TRIGGER service_event_shared_agenda_sync
AFTER UPDATE OF time_plan,event_date,start_time,is_all_day,cancelled_at,source_system ON service_events
FOR EACH ROW EXECUTE FUNCTION synchronize_shared_event_agenda();
