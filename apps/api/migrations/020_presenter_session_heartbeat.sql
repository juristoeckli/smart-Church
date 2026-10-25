ALTER TABLE presenter_output_sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
