CREATE TABLE IF NOT EXISTS eventdesk_contacts (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('company','person')),
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 160),
  email TEXT NOT NULL DEFAULT '' CHECK (char_length(email) <= 254),
  phone TEXT NOT NULL DEFAULT '' CHECK (char_length(phone) <= 40),
  street TEXT NOT NULL DEFAULT '' CHECK (char_length(street) <= 200),
  postal_code TEXT NOT NULL DEFAULT '' CHECK (char_length(postal_code) <= 24),
  city TEXT NOT NULL DEFAULT '' CHECK (char_length(city) <= 120),
  country TEXT NOT NULL DEFAULT '' CHECK (char_length(country) <= 80),
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
  roles TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  source_type TEXT,
  source_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, department_id),
  UNIQUE (department_id, source_type, source_id),
  CHECK ((source_type IS NULL) = (source_id IS NULL))
);
CREATE INDEX IF NOT EXISTS eventdesk_contacts_directory_idx ON eventdesk_contacts(department_id, active, lower(name));

CREATE TABLE IF NOT EXISTS eventdesk_contact_company_links (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  company_id UUID NOT NULL,
  person_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT '' CHECK (char_length(title) <= 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, company_id, person_id),
  CHECK (company_id <> person_id),
  FOREIGN KEY (company_id, department_id) REFERENCES eventdesk_contacts(id, department_id) ON DELETE CASCADE,
  FOREIGN KEY (person_id, department_id) REFERENCES eventdesk_contacts(id, department_id) ON DELETE CASCADE
);

INSERT INTO eventdesk_contacts(id,department_id,kind,name,email,phone,street,postal_code,city,country,notes,roles,active,source_type,source_id)
SELECT id,department_id,kind,name,email,phone,street,postal_code,city,country,notes,ARRAY['customer'],active,'customer',id FROM eventdesk_customers
ON CONFLICT (department_id,source_type,source_id) DO NOTHING;
INSERT INTO eventdesk_contacts(id,department_id,kind,name,email,phone,street,postal_code,city,country,notes,roles,active,source_type,source_id)
SELECT id,department_id,'company',name,email,phone,street,postal_code,city,country,notes,ARRAY[kind],active,'partner',id FROM eventdesk_partners
ON CONFLICT (department_id,source_type,source_id) DO NOTHING;
INSERT INTO eventdesk_contacts(id,department_id,kind,name,email,phone,notes,roles,active,source_type,source_id)
SELECT id,department_id,'person',name,email,phone,notes,ARRAY['freelancer'],active,'freelancer',id FROM eventdesk_freelancers
ON CONFLICT (department_id,source_type,source_id) DO NOTHING;
