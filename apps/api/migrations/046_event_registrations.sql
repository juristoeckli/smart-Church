ALTER TABLE service_events
  ADD COLUMN IF NOT EXISTS registration_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS registration_capacity INTEGER CHECK (registration_capacity IS NULL OR registration_capacity > 0),
  ADD COLUMN IF NOT EXISTS registration_token UUID UNIQUE;

CREATE TABLE IF NOT EXISTS event_registrations (
  id UUID PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES service_events(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL CHECK (length(first_name) BETWEEN 1 AND 80),
  last_name TEXT NOT NULL CHECK (length(last_name) BETWEEN 1 AND 80),
  email TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  status TEXT NOT NULL CHECK (status IN ('registered', 'waitlisted')),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_in_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_event_email_idx
  ON event_registrations (event_id, lower(email));
CREATE INDEX IF NOT EXISTS event_registrations_event_status_idx
  ON event_registrations (event_id, status, registered_at);
