CREATE TABLE IF NOT EXISTS event_volunteer_absences (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id,contact_id,starts_on,ends_on),
  CHECK (starts_on <= ends_on AND ends_on - starts_on <= 365)
);

CREATE INDEX IF NOT EXISTS event_volunteer_absences_scope_idx
  ON event_volunteer_absences(department_id,contact_id,starts_on,ends_on);
