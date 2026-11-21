CREATE TABLE IF NOT EXISTS people_record_saved_views (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  criteria JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(criteria)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(department_id,user_id,name)
);

CREATE INDEX IF NOT EXISTS people_record_saved_views_user_idx
  ON people_record_saved_views(department_id,user_id,lower(name));
