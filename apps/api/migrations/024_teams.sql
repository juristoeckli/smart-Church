CREATE TABLE IF NOT EXISTS church_teams (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id, name)
);

CREATE INDEX IF NOT EXISTS church_teams_department_name_idx ON church_teams (department_id, name);

CREATE TABLE IF NOT EXISTS team_members (
  team_id UUID NOT NULL REFERENCES church_teams(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT '' CHECK (length(role) <= 80),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, contact_id)
);

CREATE INDEX IF NOT EXISTS team_members_contact_idx ON team_members (contact_id);
