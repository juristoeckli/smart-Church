ALTER TABLE resources RENAME TO stored_files;
ALTER INDEX IF EXISTS resources_department_category_idx RENAME TO stored_files_department_category_idx;

DO $$
BEGIN
  IF to_regclass('public.church_groups') IS NULL AND to_regclass('public.groups') IS NOT NULL THEN
    ALTER TABLE groups RENAME TO church_groups;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS bookable_resources (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  category TEXT NOT NULL CHECK (category IN ('room', 'vehicle', 'equipment', 'other')),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  location TEXT NOT NULL DEFAULT '' CHECK (length(location) <= 160),
  capacity INTEGER CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 10000),
  requires_approval BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id, name)
);

CREATE INDEX IF NOT EXISTS bookable_resources_department_idx ON bookable_resources (department_id, active, category, name);

CREATE TABLE IF NOT EXISTS resource_bookings (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  resource_id UUID NOT NULL REFERENCES bookable_resources(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL CHECK (length(trim(purpose)) BETWEEN 1 AND 240),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('requested', 'approved', 'declined', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS resource_bookings_schedule_idx ON resource_bookings (department_id, resource_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS resource_bookings_requester_idx ON resource_bookings (requested_by, starts_at DESC);
