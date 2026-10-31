CREATE OR REPLACE FUNCTION enforce_related_site_write_fence() RETURNS trigger AS $$
DECLARE
  old_row JSONB;
  new_row JSONB;
  candidate JSONB;
  checked_department UUID;
  checked_role TEXT;
  foreign_key_value TEXT;
BEGIN
  IF current_setting('smart_church.redundancy_restore', TRUE) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;
  FOR candidate IN
    SELECT value FROM (VALUES (old_row), (new_row)) AS changed(value) WHERE value IS NOT NULL
  LOOP
    foreign_key_value := candidate ->> TG_ARGV[0];
    IF foreign_key_value IS NULL THEN CONTINUE; END IF;
    EXECUTE format('SELECT %I FROM public.%I WHERE %I=$1', 'department_id', TG_ARGV[1], TG_ARGV[2])
      INTO checked_department USING foreign_key_value::UUID;
    IF checked_department IS NULL THEN CONTINUE; END IF;
    SELECT role INTO checked_role FROM sync_site_redundancy WHERE department_id=checked_department FOR SHARE;
    IF checked_role IS DISTINCT FROM 'primary' THEN
      RAISE EXCEPTION 'Location % is read-only because it is not the active primary.', checked_department
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
