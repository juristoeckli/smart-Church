CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  first_name TEXT NOT NULL CHECK (length(trim(first_name)) BETWEEN 1 AND 80),
  last_name TEXT NOT NULL CHECK (length(trim(last_name)) BETWEEN 1 AND 80),
  email TEXT CHECK (email IS NULL OR length(email) <= 254),
  phone TEXT CHECK (phone IS NULL OR length(phone) <= 40),
  status TEXT NOT NULL CHECK (status IN ('member', 'visitor')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contacts_department_name_idx
  ON contacts (department_id, last_name, first_name);
