CREATE TABLE IF NOT EXISTS group_follow_up_tasks (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES church_groups(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  assigned_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  subject VARCHAR(160) NOT NULL CHECK (length(trim(subject)) BETWEEN 1 AND 160),
  note VARCHAR(2000) NOT NULL DEFAULT '',
  due_date DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed')),
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  completed_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id,id)
);

CREATE INDEX IF NOT EXISTS group_follow_up_tasks_queue_idx
  ON group_follow_up_tasks(department_id,status,due_date,created_at DESC);
CREATE INDEX IF NOT EXISTS group_follow_up_tasks_member_idx
  ON group_follow_up_tasks(department_id,group_id,contact_id,due_date DESC);
