CREATE TABLE IF NOT EXISTS check_in_pickup_authorizations (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  child_contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  authorized_contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  guardian_confirmed_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  guardian_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, child_contact_id, authorized_contact_id),
  CHECK (child_contact_id <> authorized_contact_id)
);
CREATE INDEX IF NOT EXISTS check_in_pickup_child_idx ON check_in_pickup_authorizations(department_id,child_contact_id);
