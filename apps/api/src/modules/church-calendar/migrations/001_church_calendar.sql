CREATE TABLE IF NOT EXISTS church_calendar_calendars (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  scope TEXT NOT NULL CHECK (scope IN ('community','group','personal')),
  group_id UUID REFERENCES church_groups(id) ON DELETE CASCADE,
  owner_user_id UUID REFERENCES app_users(id) ON DELETE CASCADE,
  color TEXT NOT NULL DEFAULT '#3b82f6' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  created_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  CHECK ((scope='group' AND group_id IS NOT NULL AND owner_user_id IS NULL) OR (scope='personal' AND group_id IS NULL AND owner_user_id IS NOT NULL) OR (scope='community' AND group_id IS NULL AND owner_user_id IS NULL))
);
CREATE INDEX IF NOT EXISTS church_calendar_calendars_department_idx ON church_calendar_calendars(department_id,scope,name) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS church_calendar_calendars_owner_idx ON church_calendar_calendars(department_id,owner_user_id) WHERE scope='personal' AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS church_calendar_appointments (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  calendar_id UUID NOT NULL REFERENCES church_calendar_calendars(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  subtitle TEXT NOT NULL DEFAULT '' CHECK (length(subtitle) <= 240),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 8000),
  starts_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  ends_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  all_day BOOLEAN NOT NULL DEFAULT false,
  place TEXT NOT NULL DEFAULT '' CHECK (length(place) <= 200),
  url TEXT NOT NULL DEFAULT '' CHECK (length(url) <= 1000),
  internal_only BOOLEAN NOT NULL DEFAULT false,
  tags TEXT[] NOT NULL DEFAULT '{}',
  recurrence JSONB,
  linked_event_id UUID REFERENCES service_events(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  CHECK (ends_at >= starts_at)
);
CREATE INDEX IF NOT EXISTS church_calendar_appointments_department_time_idx ON church_calendar_appointments(department_id,starts_at,ends_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS church_calendar_appointments_calendar_time_idx ON church_calendar_appointments(calendar_id,starts_at,ends_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS church_calendar_appointments_event_idx ON church_calendar_appointments(linked_event_id) WHERE linked_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS church_calendar_appointment_exceptions (
  appointment_id UUID NOT NULL REFERENCES church_calendar_appointments(id) ON DELETE CASCADE,
  original_start TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  cancelled BOOLEAN NOT NULL DEFAULT false,
  overrides JSONB NOT NULL DEFAULT '{}',
  updated_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (appointment_id,original_start)
);

CREATE TABLE IF NOT EXISTS church_calendar_extra_dates (
  appointment_id UUID NOT NULL REFERENCES church_calendar_appointments(id) ON DELETE CASCADE,
  starts_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  ends_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
  created_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  PRIMARY KEY (appointment_id,starts_at),
  CHECK (ends_at >= starts_at)
);
CREATE INDEX IF NOT EXISTS church_calendar_extra_dates_start_idx ON church_calendar_extra_dates(appointment_id,starts_at);

CREATE TABLE IF NOT EXISTS church_calendar_resource_links (
  appointment_id UUID NOT NULL REFERENCES church_calendar_appointments(id) ON DELETE CASCADE,
  resource_booking_id UUID NOT NULL REFERENCES resource_bookings(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  PRIMARY KEY (appointment_id,resource_booking_id)
);
