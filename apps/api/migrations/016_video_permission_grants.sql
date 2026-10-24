ALTER TABLE department_memberships
  ADD COLUMN IF NOT EXISTS video_permissions TEXT[] NOT NULL DEFAULT '{}';

UPDATE department_memberships
   SET video_permissions = CASE video_role
     WHEN 'operator' THEN ARRAY['video_basic', 'streaming_operator']::TEXT[]
     WHEN 'viewer' THEN ARRAY['video_basic']::TEXT[]
     ELSE video_permissions
   END
 WHERE video_role IN ('viewer', 'operator');

ALTER TABLE department_memberships
  DROP COLUMN IF EXISTS video_role;

ALTER TABLE department_memberships
  ADD CONSTRAINT department_memberships_video_permissions_check
  CHECK (video_permissions <@ ARRAY['video_basic', 'streaming_operator', 'stream_admin', 'routing_user', 'routing_admin']::TEXT[]);
