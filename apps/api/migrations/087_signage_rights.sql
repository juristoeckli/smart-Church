-- Preserve the former management grant as Signage Admin.
UPDATE department_memberships
SET module_permissions = jsonb_set(module_permissions, '{signage}', (
  SELECT jsonb_agg(DISTINCT CASE WHEN grant_name = 'manage' THEN 'admin' ELSE grant_name END)
  FROM jsonb_array_elements_text(module_permissions->'signage') AS rights(grant_name)
))
WHERE module_permissions->'signage' ? 'manage';
