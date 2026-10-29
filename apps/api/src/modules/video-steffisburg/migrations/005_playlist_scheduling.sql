ALTER TABLE video_planned_streams
  ADD COLUMN IF NOT EXISTS youtube_playlist_added_at TIMESTAMPTZ;
