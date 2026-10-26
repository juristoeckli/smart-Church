ALTER TABLE department_memberships
  ADD COLUMN IF NOT EXISTS permissions TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE department_memberships
  ADD CONSTRAINT department_memberships_permissions_check
  CHECK (permissions <@ ARRAY['people_view_private', 'people_manage', 'events_manage', 'groups_manage', 'resources_manage', 'files_manage']::TEXT[]);
