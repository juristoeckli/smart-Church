ALTER TABLE video_planned_streams
  ADD COLUMN IF NOT EXISTS youtube_playlist_id TEXT,
  ADD COLUMN IF NOT EXISTS youtube_playlist_title TEXT;
