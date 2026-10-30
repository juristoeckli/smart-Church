CREATE OR REPLACE FUNCTION enforce_user_site_write_fence() RETURNS trigger AS $$
DECLARE
  old_row JSONB;
  new_row JSONB;
  candidate JSONB;
  user_value TEXT;
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
    IF TG_TABLE_NAME = 'app_users' THEN
      user_value := candidate ->> 'id';
      IF user_value IS NOT NULL AND EXISTS (
        SELECT 1
          FROM department_memberships membership
          LEFT JOIN sync_site_redundancy redundancy ON redundancy.department_id=membership.department_id
         WHERE membership.user_id=user_value::UUID
           AND COALESCE(redundancy.role,'primary') <> 'primary'
      ) THEN
        RAISE EXCEPTION 'This account is linked to a location that is read-only because it is not the active primary.'
          USING ERRCODE = '55000';
      END IF;
    ELSE
      FOREACH user_value IN ARRAY ARRAY[candidate ->> 'user_id', candidate ->> 'related_user_id']
      LOOP
        IF user_value IS NOT NULL AND EXISTS (
          SELECT 1
            FROM department_memberships membership
            LEFT JOIN sync_site_redundancy redundancy ON redundancy.department_id=membership.department_id
           WHERE membership.user_id=user_value::UUID
             AND COALESCE(redundancy.role,'primary') <> 'primary'
        ) THEN
          RAISE EXCEPTION 'This account is linked to a location that is read-only because it is not the active primary.'
            USING ERRCODE = '55000';
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $user_fence$
BEGIN
  IF to_regclass('public.app_users') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS smart_church_account_write_fence ON public.app_users;
    CREATE TRIGGER smart_church_account_write_fence
      BEFORE INSERT OR UPDATE OR DELETE ON public.app_users
      FOR EACH ROW EXECUTE FUNCTION public.enforce_user_site_write_fence();
  END IF;

  IF to_regclass('public.user_phone_numbers') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS smart_church_phone_write_fence ON public.user_phone_numbers;
    CREATE TRIGGER smart_church_phone_write_fence
      BEFORE INSERT OR UPDATE OR DELETE ON public.user_phone_numbers
      FOR EACH ROW EXECUTE FUNCTION public.enforce_user_site_write_fence();
  END IF;

  IF to_regclass('public.user_relationships') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS smart_church_relationship_write_fence ON public.user_relationships;
    CREATE TRIGGER smart_church_relationship_write_fence
      BEFORE INSERT OR UPDATE OR DELETE ON public.user_relationships
      FOR EACH ROW EXECUTE FUNCTION public.enforce_user_site_write_fence();
  END IF;
END
$user_fence$;
