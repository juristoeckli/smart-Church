ALTER TABLE service_events
  ADD COLUMN IF NOT EXISTS attendance_adults INTEGER NOT NULL DEFAULT 0 CHECK (attendance_adults >= 0),
  ADD COLUMN IF NOT EXISTS attendance_children INTEGER NOT NULL DEFAULT 0 CHECK (attendance_children >= 0),
  ADD COLUMN IF NOT EXISTS attendance_recorded_at TIMESTAMPTZ;
