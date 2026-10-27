-- The Video module is a Steffisburg-specific custom module. Preserve existing
-- location enablement and grants while assigning it a deployment-specific ID.
UPDATE departments
   SET enabled_modules = array_remove(array_remove(enabled_modules, 'video'), 'video-steffisburg')
 WHERE 'video' = ANY(enabled_modules)
    OR 'video-steffisburg' = ANY(enabled_modules);

UPDATE departments
   SET enabled_modules = array_append(enabled_modules, 'video-steffisburg')
 WHERE lower(name) = 'steffisburg'
   AND NOT ('video-steffisburg' = ANY(enabled_modules));

UPDATE department_memberships
   SET module_permissions = (module_permissions - 'video') ||
     CASE
       WHEN module_permissions ? 'video-steffisburg' THEN '{}'::jsonb
       WHEN module_permissions ? 'video' THEN jsonb_build_object('video-steffisburg', module_permissions->'video')
       ELSE '{}'::jsonb
     END
 WHERE module_permissions ? 'video';
