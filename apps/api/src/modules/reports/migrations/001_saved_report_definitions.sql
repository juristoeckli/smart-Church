CREATE TABLE IF NOT EXISTS saved_report_definitions (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  report_key TEXT NOT NULL CHECK (report_key IN ('people-directory','group-summary','group-roster','event-attendance','visitor-follow-up','finance-account-summary')),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  filters JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(filters)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id, owner_user_id, name)
);

CREATE INDEX IF NOT EXISTS saved_report_definitions_department_idx
  ON saved_report_definitions (department_id, lower(name));
