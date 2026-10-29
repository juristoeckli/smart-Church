CREATE TABLE IF NOT EXISTS video_planned_streams (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  event_id UUID REFERENCES service_events(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  speaker TEXT NOT NULL DEFAULT '',
  theme TEXT NOT NULL DEFAULT '',
  scheduled_start_at TIMESTAMPTZ NOT NULL,
  privacy_status TEXT NOT NULL DEFAULT 'unlisted' CHECK (privacy_status IN ('private', 'unlisted', 'public')),
  youtube_broadcast_id TEXT,
  youtube_status TEXT NOT NULL DEFAULT 'local' CHECK (youtube_status IN ('local', 'scheduled', 'error')),
  youtube_error TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS video_planned_streams_department_start
  ON video_planned_streams (department_id, scheduled_start_at);

CREATE TABLE IF NOT EXISTS video_youtube_connections (
  department_id UUID PRIMARY KEY REFERENCES departments(id) ON DELETE CASCADE,
  encrypted_refresh_token TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_title TEXT NOT NULL,
  connected_by TEXT NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
