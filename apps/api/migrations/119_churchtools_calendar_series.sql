CREATE TABLE IF NOT EXISTS churchtools_migration_calendar_series (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  instance_url TEXT NOT NULL,
  source_calendar_id TEXT NOT NULL,
  source_series_id TEXT NOT NULL,
  appointment_id UUID,
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (department_id, instance_url, source_calendar_id, source_series_id),
  UNIQUE (department_id, appointment_id)
);
