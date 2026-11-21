CREATE TABLE IF NOT EXISTS churchtools_migration_booking_history (
  department_id UUID NOT NULL REFERENCES churchtools_sync_settings(department_id) ON DELETE CASCADE,
  instance_url TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  source_id TEXT NOT NULL,
  resource_source_id TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL CHECK (occurrence_count BETWEEN 1 AND 20000),
  encrypted_snapshot TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, instance_url, start_date, end_date, source_id),
  CHECK (start_date <= end_date)
);
