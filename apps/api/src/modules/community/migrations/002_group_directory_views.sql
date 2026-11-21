CREATE TABLE IF NOT EXISTS group_directory_views (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  search_text TEXT NOT NULL DEFAULT '' CHECK (length(search_text) <= 120),
  source_filter TEXT NOT NULL DEFAULT 'all' CHECK (source_filter IN ('all','local','churchtools','elvanto')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS group_directory_views_owner_name_idx
  ON group_directory_views(department_id,user_id,lower(name));
