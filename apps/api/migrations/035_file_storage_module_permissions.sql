UPDATE department_memberships
   SET module_permissions = jsonb_set(
         COALESCE(module_permissions, '{}'::JSONB),
         '{file-storage}',
         COALESCE(module_permissions->'file-storage', '[]'::JSONB) || '["manage"]'::JSONB,
         true
       ),
       permissions = array_remove(permissions, 'files_manage')
 WHERE 'files_manage' = ANY(permissions);

ALTER TABLE department_memberships
  DROP CONSTRAINT IF EXISTS department_memberships_permissions_check;

ALTER TABLE department_memberships
  ADD CONSTRAINT department_memberships_permissions_check
  CHECK (permissions <@ ARRAY['people_view_private', 'people_manage', 'events_manage', 'groups_manage', 'resources_manage']::TEXT[]);
