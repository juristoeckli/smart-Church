CREATE TABLE IF NOT EXISTS service_events (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  kind TEXT NOT NULL CHECK (kind IN ('service', 'meeting', 'community', 'other')),
  event_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME,
  location TEXT NOT NULL CHECK (length(trim(location)) BETWEEN 1 AND 160),
  description TEXT CHECK (description IS NULL OR length(description) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time IS NULL OR end_time > start_time)
);

CREATE INDEX IF NOT EXISTS service_events_department_schedule_idx
  ON service_events (department_id, event_date, start_time);
