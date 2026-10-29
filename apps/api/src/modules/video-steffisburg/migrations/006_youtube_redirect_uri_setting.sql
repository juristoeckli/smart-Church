ALTER TABLE video_module_settings
  ADD COLUMN IF NOT EXISTS youtube_redirect_uri TEXT NOT NULL DEFAULT '';
