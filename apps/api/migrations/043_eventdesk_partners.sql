CREATE TABLE IF NOT EXISTS eventdesk_partners (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('supplier', 'venue')),
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 160),
  contact_person TEXT NOT NULL DEFAULT '' CHECK (char_length(contact_person) <= 160),
  email TEXT NOT NULL DEFAULT '' CHECK (char_length(email) <= 254),
  phone TEXT NOT NULL DEFAULT '' CHECK (char_length(phone) <= 40),
  street TEXT NOT NULL DEFAULT '' CHECK (char_length(street) <= 200),
  postal_code TEXT NOT NULL DEFAULT '' CHECK (char_length(postal_code) <= 24),
  city TEXT NOT NULL DEFAULT '' CHECK (char_length(city) <= 120),
  country TEXT NOT NULL DEFAULT '' CHECK (char_length(country) <= 80),
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, department_id)
);

CREATE INDEX IF NOT EXISTS eventdesk_partners_directory_idx
  ON eventdesk_partners (department_id, kind, active, lower(name));

ALTER TABLE eventdesk_assets
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES eventdesk_partners(id) ON DELETE SET NULL;

ALTER TABLE eventdesk_jobs
  ADD COLUMN IF NOT EXISTS venue_id UUID REFERENCES eventdesk_partners(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS eventdesk_assets_supplier_idx ON eventdesk_assets (department_id, supplier_id);
CREATE INDEX IF NOT EXISTS eventdesk_jobs_venue_idx ON eventdesk_jobs (department_id, venue_id);
