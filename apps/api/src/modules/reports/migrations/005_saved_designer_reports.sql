CREATE TABLE IF NOT EXISTS saved_designer_reports (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  definition JSONB NOT NULL CHECK (jsonb_typeof(definition)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id,owner_user_id,name)
);
CREATE INDEX IF NOT EXISTS saved_designer_reports_owner_idx
  ON saved_designer_reports(department_id,owner_user_id,lower(name));
