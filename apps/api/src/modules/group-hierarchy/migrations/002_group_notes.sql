CREATE TABLE IF NOT EXISTS group_notes (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES church_groups(id) ON DELETE CASCADE,
  title VARCHAR(160) NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 10000),
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  archived_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  UNIQUE (department_id,id)
);

CREATE INDEX IF NOT EXISTS group_notes_group_idx
  ON group_notes(department_id,group_id,created_at DESC) WHERE archived_at IS NULL;
