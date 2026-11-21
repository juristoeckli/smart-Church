CREATE TABLE IF NOT EXISTS event_volunteer_absence_import_consents (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  instance_url TEXT NOT NULL,
  source_person_id TEXT NOT NULL CHECK (source_person_id ~ '^[1-9][0-9]{0,15}$'),
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  consented_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id,contact_id),
  CHECK (starts_on <= ends_on AND ends_on - starts_on <= 365)
);

CREATE TABLE IF NOT EXISTS churchtools_migration_absence_receipts (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  instance_url TEXT NOT NULL,
  source_person_id TEXT NOT NULL CHECK (source_person_id ~ '^[1-9][0-9]{0,15}$'),
  source_absence_id TEXT NOT NULL CHECK (source_absence_id ~ '^[1-9][0-9]{0,15}$'),
  original_start DATE NOT NULL,
  original_end DATE NOT NULL,
  absence_id UUID UNIQUE REFERENCES event_volunteer_absences(id) ON DELETE SET NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id,instance_url,source_person_id,source_absence_id),
  CHECK (original_start <= original_end)
);
