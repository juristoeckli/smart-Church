CREATE TABLE IF NOT EXISTS group_meetings (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES church_groups(id) ON DELETE CASCADE,
  meeting_date DATE NOT NULL,
  title TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, meeting_date, title)
);

CREATE INDEX IF NOT EXISTS group_meetings_group_date_idx ON group_meetings (group_id, meeting_date DESC);

CREATE TABLE IF NOT EXISTS group_meeting_attendance (
  meeting_id UUID NOT NULL REFERENCES group_meetings(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'absent' CHECK (status IN ('present', 'absent', 'excused')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, contact_id)
);

CREATE INDEX IF NOT EXISTS group_meeting_attendance_contact_idx ON group_meeting_attendance (contact_id, meeting_id);
