ALTER TABLE service_events ADD COLUMN IF NOT EXISTS shared_agenda_hidden_item_ids UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE service_events DROP CONSTRAINT IF EXISTS service_events_shared_agenda_hidden_item_limit;
ALTER TABLE service_events ADD CONSTRAINT service_events_shared_agenda_hidden_item_limit
  CHECK (cardinality(shared_agenda_hidden_item_ids) <= 100);

CREATE OR REPLACE FUNCTION identify_shared_agenda_items(plan JSONB)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  entry JSONB;
  item_id UUID;
  used UUID[] := '{}';
  output JSONB := '[]'::jsonb;
BEGIN
  FOR entry IN SELECT value FROM jsonb_array_elements(plan) LOOP
    item_id := NULL;
    IF entry->>'agendaItemId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
      item_id := (entry->>'agendaItemId')::uuid;
    END IF;
    IF item_id IS NULL OR item_id=ANY(used) THEN
      item_id := gen_random_uuid();
    END IF;
    used := array_append(used, item_id);
    output := output || jsonb_build_array(entry || jsonb_build_object('agendaItemId', item_id));
  END LOOP;
  RETURN output;
END;
$$;

CREATE OR REPLACE FUNCTION shared_event_agenda_plan(plan JSONB, offset_minutes INTEGER, hidden_ids UUID[])
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'agendaItemId', item->'agendaItemId',
    'title', item->'title',
    'section', item->'section',
    'durationMinutes', item->'durationMinutes',
    'songId', item->'songId',
    'arrangementId', item->'arrangementId',
    'startTime', CASE WHEN item->>'startTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      THEN to_char(date '2000-01-01' + (item->>'startTime')::time + make_interval(mins => offset_minutes), 'HH24:MI') END
  )) ORDER BY ordinal), '[]'::jsonb)
  FROM jsonb_array_elements(plan) WITH ORDINALITY AS entries(item, ordinal)
  WHERE NOT EXISTS (SELECT 1 FROM unnest(hidden_ids) hidden(id) WHERE hidden.id::text=item->>'agendaItemId')
$$;

CREATE OR REPLACE FUNCTION shared_event_agenda_plan(plan JSONB, offset_minutes INTEGER)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT shared_event_agenda_plan(plan, offset_minutes, '{}')
$$;

CREATE OR REPLACE FUNCTION maintain_shared_event_agenda_ids()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.shared_agenda_source_id IS DISTINCT FROM OLD.shared_agenda_source_id THEN
    NEW.shared_agenda_hidden_item_ids := '{}';
  END IF;
  IF NEW.time_plan IS DISTINCT FROM OLD.time_plan AND NEW.shared_agenda_source_id IS NULL
    AND EXISTS (SELECT 1 FROM service_events linked WHERE linked.department_id=NEW.department_id AND linked.shared_agenda_source_id=NEW.id) THEN
    NEW.time_plan := identify_shared_agenda_items(NEW.time_plan);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS service_event_agenda_item_ids ON service_events;
CREATE TRIGGER service_event_agenda_item_ids
BEFORE UPDATE OF time_plan,shared_agenda_source_id ON service_events
FOR EACH ROW EXECUTE FUNCTION maintain_shared_event_agenda_ids();

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
    UPDATE service_events target
      SET time_plan=shared_event_agenda_plan(NEW.time_plan,
        (extract(epoch FROM (target.start_time - NEW.start_time)) / 60)::integer, target.shared_agenda_hidden_item_ids),
        shared_agenda_hidden_item_ids=ARRAY(SELECT hidden.id FROM unnest(target.shared_agenda_hidden_item_ids) hidden(id)
          WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.time_plan) item WHERE item->>'agendaItemId'=hidden.id::text))
      WHERE target.shared_agenda_source_id=NEW.id AND target.department_id=NEW.department_id;
  END IF;
  RETURN NULL;
END;
$$;

UPDATE service_events source SET time_plan=identify_shared_agenda_items(source.time_plan)
WHERE EXISTS (SELECT 1 FROM service_events target WHERE target.department_id=source.department_id AND target.shared_agenda_source_id=source.id);
