CREATE TABLE IF NOT EXISTS module_notification_announcement_batches (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sender_name TEXT NOT NULL,
  title TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('location', 'groups')),
  group_names TEXT[] NOT NULL DEFAULT '{}',
  recipient_count INTEGER NOT NULL CHECK (recipient_count >= 0),
  email_queued_count INTEGER NOT NULL DEFAULT 0 CHECK (email_queued_count BETWEEN 0 AND recipient_count),
  UNIQUE (department_id, id)
);
CREATE INDEX IF NOT EXISTS idx_announcement_batches_location
  ON module_notification_announcement_batches (department_id, sent_at DESC, id DESC);
