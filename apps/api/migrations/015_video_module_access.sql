ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS enabled_modules TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE department_memberships
  ADD COLUMN IF NOT EXISTS video_role TEXT NOT NULL DEFAULT 'none'
  CHECK (video_role IN ('none', 'viewer', 'operator'));

-- Video streaming is currently a Steffisburg-specific module. New sites do not
-- inherit it automatically; renaming Steffisburg keeps its module assignment.
UPDATE departments
   SET enabled_modules = array_append(enabled_modules, 'video')
 WHERE lower(name) = 'steffisburg'
   AND NOT ('video' = ANY(enabled_modules));
