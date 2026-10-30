CREATE TABLE IF NOT EXISTS video_module_department_settings (
  department_id UUID PRIMARY KEY REFERENCES departments(id) ON DELETE CASCADE,
  youtube_client_id TEXT NOT NULL DEFAULT '',
  youtube_client_secret_encrypted TEXT,
  youtube_redirect_uri TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Preserve the legacy shared OAuth configuration for every location that
-- currently has Video enabled, then let each location manage its own values.
INSERT INTO video_module_department_settings (
  department_id, youtube_client_id, youtube_client_secret_encrypted,
  youtube_redirect_uri, updated_by, updated_at
)
SELECT department.id, settings.youtube_client_id,
       settings.youtube_client_secret_encrypted,
       settings.youtube_redirect_uri, settings.updated_by, settings.updated_at
  FROM video_module_settings settings
  JOIN departments department ON (
    'video-steffisburg' = ANY(department.enabled_modules)
    OR EXISTS (
      SELECT 1 FROM installation_modules module
       WHERE module.installation_id=department.installation_id
         AND module.module_id='video-steffisburg'
         AND module.enabled=TRUE
         AND (module.required=TRUE OR module.client_managed=FALSE)
    )
  )
 WHERE settings.singleton=TRUE
ON CONFLICT (department_id) DO NOTHING;
