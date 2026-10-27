ALTER TABLE department_memberships
  ADD COLUMN IF NOT EXISTS module_permissions JSONB NOT NULL DEFAULT '{}'::JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'department_memberships_module_permissions_object_check'
       AND conrelid = 'department_memberships'::regclass
  ) THEN
    ALTER TABLE department_memberships
      ADD CONSTRAINT department_memberships_module_permissions_object_check
      CHECK (jsonb_typeof(module_permissions) = 'object');
  END IF;
END $$;

UPDATE department_memberships
   SET module_permissions = jsonb_strip_nulls(jsonb_build_object(
     'video', to_jsonb(video_permissions),
     'presenter', to_jsonb(presenter_permissions)
   ))
 WHERE module_permissions = '{}'::JSONB
   AND (cardinality(video_permissions) > 0 OR cardinality(presenter_permissions) > 0);
