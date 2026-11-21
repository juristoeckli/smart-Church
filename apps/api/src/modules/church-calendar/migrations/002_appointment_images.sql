CREATE UNIQUE INDEX IF NOT EXISTS church_calendar_appointments_id_department_idx ON church_calendar_appointments(id,department_id);
CREATE UNIQUE INDEX IF NOT EXISTS church_calendar_calendars_id_department_idx ON church_calendar_calendars(id,department_id);

CREATE TABLE IF NOT EXISTS church_calendar_appointment_images (
  appointment_id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/gif','image/webp')),
  filename TEXT NOT NULL CHECK (length(filename) BETWEEN 1 AND 180),
  content BYTEA NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 1048576),
  uploaded_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (appointment_id,department_id) REFERENCES church_calendar_appointments(id,department_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS church_calendar_public_feeds (
  calendar_id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  FOREIGN KEY (calendar_id,department_id) REFERENCES church_calendar_calendars(id,department_id) ON DELETE CASCADE
);
