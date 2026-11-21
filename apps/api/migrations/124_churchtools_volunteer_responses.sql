CREATE TABLE IF NOT EXISTS churchtools_migration_person_provenance (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  instance_url TEXT NOT NULL,
  source_person_id TEXT NOT NULL CHECK (source_person_id ~ '^[1-9][0-9]{0,15}$'),
  contact_id UUID NOT NULL UNIQUE REFERENCES contacts(id) ON DELETE CASCADE,
  PRIMARY KEY (department_id,instance_url,source_person_id)
);

CREATE TABLE IF NOT EXISTS churchtools_migration_volunteer_responses (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  instance_url TEXT NOT NULL,
  source_event_id TEXT NOT NULL CHECK (source_event_id ~ '^[1-9][0-9]{0,15}$'),
  source_assignment_id TEXT NOT NULL CHECK (source_assignment_id ~ '^[1-9][0-9]{0,15}$'),
  source_service_id TEXT NOT NULL CHECK (source_service_id ~ '^[1-9][0-9]{0,15}$'),
  source_person_id TEXT NOT NULL CHECK (source_person_id ~ '^[1-9][0-9]{0,15}$'),
  event_id UUID NOT NULL REFERENCES service_events(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  original_position_index INT NOT NULL CHECK (original_position_index >= 0),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id,instance_url,source_event_id,source_assignment_id)
);
