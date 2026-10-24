ALTER TABLE department_memberships
  ADD COLUMN IF NOT EXISTS presenter_permissions TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE department_memberships
  ADD CONSTRAINT department_memberships_presenter_permissions_check
  CHECK (presenter_permissions <@ ARRAY['editor', 'operator', 'admin']::TEXT[]);

-- Presenter is a separate, Steffisburg-only module for now.
UPDATE departments
   SET enabled_modules = array_append(enabled_modules, 'presenter')
 WHERE lower(name) = 'steffisburg'
   AND NOT ('presenter' = ANY(enabled_modules));
