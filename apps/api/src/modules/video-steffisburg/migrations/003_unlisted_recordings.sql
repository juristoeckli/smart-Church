ALTER TABLE video_planned_streams
  DROP CONSTRAINT IF EXISTS video_planned_streams_youtube_status_check;

ALTER TABLE video_planned_streams
  ADD CONSTRAINT video_planned_streams_youtube_status_check
  CHECK (youtube_status IN ('local', 'scheduled', 'error', 'recorded_unlisted'));
