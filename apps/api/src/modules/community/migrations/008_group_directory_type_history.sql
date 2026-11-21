CREATE TABLE group_directory_type_history (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES church_groups(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  previous_type TEXT,
  new_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX group_directory_type_history_group_idx ON group_directory_type_history (department_id, group_id, created_at DESC);
