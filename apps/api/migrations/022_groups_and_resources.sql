CREATE TABLE IF NOT EXISTS church_groups (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id, name)
);

CREATE INDEX IF NOT EXISTS groups_department_name_idx ON church_groups (department_id, name);

CREATE TABLE IF NOT EXISTS group_members (
  group_id UUID NOT NULL REFERENCES church_groups(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, contact_id)
);

CREATE INDEX IF NOT EXISTS group_members_contact_idx ON group_members (contact_id);

CREATE TABLE IF NOT EXISTS resources (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  category TEXT NOT NULL DEFAULT 'General' CHECK (length(trim(category)) BETWEEN 1 AND 80),
  file_name TEXT NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
  content_type TEXT NOT NULL CHECK (length(content_type) BETWEEN 1 AND 120),
  file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 26214400),
  file_data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resources_department_category_idx ON resources (department_id, category, title);
