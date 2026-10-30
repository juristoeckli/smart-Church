CREATE OR REPLACE FUNCTION enforce_site_write_fence() RETURNS trigger AS $$
DECLARE
  checked_department UUID;
  checked_role TEXT;
  department_ids UUID[];
BEGIN
  IF current_setting('smart_church.redundancy_restore', TRUE) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    department_ids := ARRAY[NULLIF(to_jsonb(NEW)->>'department_id', '')::UUID];
  ELSIF TG_OP = 'DELETE' THEN
    department_ids := ARRAY[NULLIF(to_jsonb(OLD)->>'department_id', '')::UUID];
  ELSE
    department_ids := ARRAY[
      NULLIF(to_jsonb(OLD)->>'department_id', '')::UUID,
      NULLIF(to_jsonb(NEW)->>'department_id', '')::UUID
    ];
  END IF;

  FOR checked_department IN
    SELECT DISTINCT candidate.department_id
      FROM unnest(department_ids) AS candidate(department_id)
     WHERE candidate.department_id IS NOT NULL
  LOOP
    SELECT role INTO checked_role
      FROM sync_site_redundancy
     WHERE department_id = checked_department
     FOR SHARE;
    IF checked_role IS DISTINCT FROM 'primary' THEN
      RAISE EXCEPTION 'Location % is read-only because it is not the active primary.', checked_department
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
