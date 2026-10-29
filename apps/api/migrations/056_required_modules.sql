ALTER TABLE departments
  ALTER COLUMN enabled_modules SET DEFAULT ARRAY['file-storage', 'notifications']::TEXT[];

UPDATE departments AS department
   SET enabled_modules = ARRAY(
     SELECT DISTINCT module_id
       FROM unnest(department.enabled_modules || ARRAY['file-storage', 'notifications']::TEXT[]) AS enabled(module_id)
      ORDER BY module_id
   ),
       updated_at = now();
