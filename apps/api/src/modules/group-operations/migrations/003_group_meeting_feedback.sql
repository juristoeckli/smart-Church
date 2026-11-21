CREATE UNIQUE INDEX IF NOT EXISTS group_meetings_feedback_scope_idx
  ON group_meetings(department_id,group_id,id);

CREATE TABLE IF NOT EXISTS group_meeting_feedback_templates (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES church_groups(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  questions JSONB NOT NULL CHECK (jsonb_typeof(questions)='array' AND jsonb_array_length(questions) BETWEEN 1 AND 10),
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id,group_id),
  UNIQUE (department_id,id)
);

CREATE TABLE IF NOT EXISTS group_meeting_feedback_responses (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES church_groups(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL,
  answers JSONB NOT NULL CHECK (jsonb_typeof(answers)='object'),
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (meeting_id),
  FOREIGN KEY (department_id,group_id,meeting_id) REFERENCES group_meetings(department_id,group_id,id) ON DELETE CASCADE,
  UNIQUE (department_id,id)
);

CREATE INDEX IF NOT EXISTS group_meeting_feedback_group_idx
  ON group_meeting_feedback_responses(department_id,group_id,updated_at DESC);
