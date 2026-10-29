CREATE TABLE IF NOT EXISTS eventdesk_jobs (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 160),
  customer_name TEXT NOT NULL DEFAULT '' CHECK (char_length(customer_name) <= 160),
  customer_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  linked_event_id UUID REFERENCES service_events(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  venue TEXT NOT NULL DEFAULT '' CHECK (char_length(venue) <= 240),
  status TEXT NOT NULL DEFAULT 'lead' CHECK (status IN ('lead', 'quoted', 'confirmed', 'in_progress', 'completed', 'cancelled')),
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, department_id),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS eventdesk_jobs_schedule_idx ON eventdesk_jobs (department_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS eventdesk_jobs_status_idx ON eventdesk_jobs (department_id, status, starts_at);

CREATE TABLE IF NOT EXISTS eventdesk_assets (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 160),
  category TEXT NOT NULL DEFAULT 'General' CHECK (char_length(trim(category)) BETWEEN 1 AND 80),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 100000),
  daily_rate_cents INTEGER NOT NULL DEFAULT 0 CHECK (daily_rate_cents BETWEEN 0 AND 100000000),
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, department_id)
);

CREATE INDEX IF NOT EXISTS eventdesk_assets_department_idx ON eventdesk_assets (department_id, active, category, name);

CREATE TABLE IF NOT EXISTS eventdesk_job_assets (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  job_id UUID NOT NULL,
  asset_id UUID NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100000),
  daily_rate_cents INTEGER NOT NULL CHECK (daily_rate_cents BETWEEN 0 AND 100000000),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'checked_out', 'returned', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, department_id),
  FOREIGN KEY (job_id, department_id) REFERENCES eventdesk_jobs(id, department_id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id, department_id) REFERENCES eventdesk_assets(id, department_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS eventdesk_job_assets_job_idx ON eventdesk_job_assets (department_id, job_id);
CREATE INDEX IF NOT EXISTS eventdesk_job_assets_asset_idx ON eventdesk_job_assets (department_id, asset_id, status);

CREATE TABLE IF NOT EXISTS eventdesk_job_crew (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  job_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (char_length(trim(role)) BETWEEN 1 AND 100),
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  hours NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (hours BETWEEN 0 AND 1000),
  hourly_rate_cents INTEGER NOT NULL DEFAULT 0 CHECK (hourly_rate_cents BETWEEN 0 AND 100000000),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'assigned', 'confirmed', 'declined')),
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, department_id),
  FOREIGN KEY (job_id, department_id) REFERENCES eventdesk_jobs(id, department_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS eventdesk_job_crew_job_idx ON eventdesk_job_crew (department_id, job_id, status);
CREATE INDEX IF NOT EXISTS eventdesk_job_crew_contact_idx ON eventdesk_job_crew (department_id, contact_id);
