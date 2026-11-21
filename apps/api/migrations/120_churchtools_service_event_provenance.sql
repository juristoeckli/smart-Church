CREATE TABLE IF NOT EXISTS churchtools_service_event_provenance (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  instance_url TEXT NOT NULL,
  source_event_id TEXT NOT NULL CHECK (source_event_id ~ '^[1-9][0-9]*$'),
  source_appointment_id TEXT NOT NULL CHECK (source_appointment_id ~ '^[1-9][0-9]*$'),
  event_id UUID NOT NULL UNIQUE REFERENCES service_events(id) ON DELETE CASCADE,
  PRIMARY KEY (department_id,instance_url,source_event_id)
);
