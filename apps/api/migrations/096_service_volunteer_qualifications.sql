CREATE TABLE IF NOT EXISTS service_volunteer_qualifications (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  category TEXT NOT NULL DEFAULT 'General' CHECK (length(trim(category)) BETWEEN 1 AND 80),
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, department_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS service_volunteer_qualifications_name_idx
  ON service_volunteer_qualifications(department_id, lower(name));
CREATE INDEX IF NOT EXISTS service_volunteer_qualifications_category_idx
  ON service_volunteer_qualifications(department_id, lower(category), lower(name)) WHERE active=true;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_id_department_idx ON contacts(id, department_id);

CREATE TABLE IF NOT EXISTS contact_service_qualifications (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL,
  qualification_id UUID NOT NULL,
  granted_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, contact_id, qualification_id),
  FOREIGN KEY (contact_id, department_id) REFERENCES contacts(id, department_id) ON DELETE CASCADE,
  FOREIGN KEY (qualification_id, department_id) REFERENCES service_volunteer_qualifications(id, department_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS contact_service_qualifications_lookup_idx
  ON contact_service_qualifications(department_id, qualification_id, contact_id);
