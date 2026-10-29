ALTER TABLE eventdesk_inspection_schedules
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS eventdesk_inspection_reminder_attempts (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  schedule_id UUID NOT NULL,
  inspection_due_date DATE NOT NULL,
  recipient_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  provider_message_id TEXT,
  error_summary TEXT NOT NULL DEFAULT '' CHECK (char_length(error_summary) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  UNIQUE (department_id,schedule_id,inspection_due_date),
  FOREIGN KEY (schedule_id,department_id) REFERENCES eventdesk_inspection_schedules(id,department_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS eventdesk_inspection_reminders_history_idx
  ON eventdesk_inspection_reminder_attempts (department_id,created_at DESC);
