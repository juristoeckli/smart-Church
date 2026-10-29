ALTER TABLE video_module_settings
  ADD COLUMN IF NOT EXISTS youtube_client_secret_encrypted TEXT;
