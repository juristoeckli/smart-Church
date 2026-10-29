CREATE TABLE IF NOT EXISTS video_module_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  youtube_client_id TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE video_youtube_connections
  ADD COLUMN IF NOT EXISTS oauth_client_id TEXT NOT NULL DEFAULT '';
