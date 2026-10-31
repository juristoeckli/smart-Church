CREATE OR REPLACE FUNCTION smart_church_sync_notify_site_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  changed_row JSONB;
  changed_department TEXT;
BEGIN
  changed_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  changed_department := CASE WHEN TG_TABLE_NAME = 'departments' THEN changed_row->>'id' ELSE changed_row->>'department_id' END;
  IF changed_department IS NOT NULL THEN
    PERFORM pg_notify('smart_church_site_changed', changed_department);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION smart_church_sync_notify_account_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  changed_row JSONB;
  affected_department TEXT;
BEGIN
  changed_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  FOR affected_department IN
    SELECT DISTINCT membership.department_id::TEXT
      FROM department_memberships membership
     WHERE membership.user_id::TEXT IN (
       changed_row->>'id', changed_row->>'user_id', changed_row->>'related_user_id'
     )
  LOOP
    PERFORM pg_notify('smart_church_site_changed', affected_department);
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
