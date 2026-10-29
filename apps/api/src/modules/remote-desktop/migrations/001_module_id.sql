-- Rename the user-visible System Laptop module ID without disabling it at
-- locations that already have it enabled.
UPDATE departments
   SET enabled_modules = CASE
     WHEN 'remote-desktop' = ANY(enabled_modules)
       THEN array_remove(enabled_modules, 'system-laptop')
     ELSE array_replace(enabled_modules, 'system-laptop', 'remote-desktop')
   END,
       updated_at = now()
 WHERE 'system-laptop' = ANY(enabled_modules);

UPDATE department_memberships
   SET module_permissions = (module_permissions - 'system-laptop') ||
     CASE
       WHEN module_permissions ? 'remote-desktop' THEN '{}'::jsonb
       WHEN module_permissions ? 'system-laptop' THEN jsonb_build_object('remote-desktop', module_permissions->'system-laptop')
       ELSE '{}'::jsonb
     END
 WHERE module_permissions ? 'system-laptop';
