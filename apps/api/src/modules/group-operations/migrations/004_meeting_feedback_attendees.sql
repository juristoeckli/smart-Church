CREATE TABLE IF NOT EXISTS group_meeting_feedback_attendee_submissions (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES church_groups(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  answers JSONB NOT NULL CHECK (jsonb_typeof(answers)='object'),
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (meeting_id,contact_id),
  FOREIGN KEY (department_id,group_id,meeting_id) REFERENCES group_meetings(department_id,group_id,id) ON DELETE CASCADE,
  UNIQUE (department_id,id)
);

CREATE INDEX IF NOT EXISTS group_meeting_feedback_attendees_idx
  ON group_meeting_feedback_attendee_submissions(department_id,group_id,meeting_id,updated_at DESC);
