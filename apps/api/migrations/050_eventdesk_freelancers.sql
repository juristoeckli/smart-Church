CREATE TABLE IF NOT EXISTS eventdesk_freelancers (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 160),
  email TEXT NOT NULL DEFAULT '' CHECK (char_length(email) <= 254),
  phone TEXT NOT NULL DEFAULT '' CHECK (char_length(phone) <= 40),
  roles TEXT[] NOT NULL DEFAULT '{}',
  hourly_rate_cents INTEGER NOT NULL DEFAULT 0 CHECK (hourly_rate_cents BETWEEN 0 AND 100000000),
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, department_id)
);

CREATE INDEX IF NOT EXISTS eventdesk_freelancers_department_active_idx
  ON eventdesk_freelancers (department_id, active, lower(name));

CREATE TABLE IF NOT EXISTS eventdesk_freelancer_unavailability (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  freelancer_id UUID NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL DEFAULT '' CHECK (char_length(reason) <= 240),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  FOREIGN KEY (freelancer_id, department_id) REFERENCES eventdesk_freelancers(id, department_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS eventdesk_freelancer_unavailability_period_idx
  ON eventdesk_freelancer_unavailability (department_id, freelancer_id, starts_at, ends_at);

ALTER TABLE eventdesk_job_crew
  ADD COLUMN IF NOT EXISTS freelancer_id UUID,
  DROP CONSTRAINT IF EXISTS eventdesk_job_crew_status_check,
  ADD CONSTRAINT eventdesk_job_crew_status_check CHECK (status IN ('requested', 'assigned', 'invited', 'confirmed', 'declined')),
  ADD CONSTRAINT eventdesk_job_crew_person_check CHECK (contact_id IS NULL OR freelancer_id IS NULL),
  ADD CONSTRAINT eventdesk_job_crew_freelancer_fk FOREIGN KEY (freelancer_id, department_id)
    REFERENCES eventdesk_freelancers(id, department_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS eventdesk_job_crew_freelancer_idx
  ON eventdesk_job_crew (department_id, freelancer_id, status);

CREATE TABLE IF NOT EXISTS eventdesk_crew_deliveries (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  crew_id UUID NOT NULL,
  freelancer_id UUID NOT NULL,
  recipient_email TEXT NOT NULL CHECK (char_length(recipient_email) <= 254),
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  provider_message_id TEXT NOT NULL DEFAULT '' CHECK (char_length(provider_message_id) <= 300),
  error_summary TEXT NOT NULL DEFAULT '' CHECK (char_length(error_summary) <= 500),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (crew_id, department_id) REFERENCES eventdesk_job_crew(id, department_id) ON DELETE CASCADE,
  FOREIGN KEY (freelancer_id, department_id) REFERENCES eventdesk_freelancers(id, department_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS eventdesk_crew_deliveries_crew_idx
  ON eventdesk_crew_deliveries (department_id, crew_id, created_at DESC);
