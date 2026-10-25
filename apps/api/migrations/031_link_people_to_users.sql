ALTER TABLE department_memberships
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS department_memberships_contact_idx
  ON department_memberships (department_id, contact_id)
  WHERE contact_id IS NOT NULL;
