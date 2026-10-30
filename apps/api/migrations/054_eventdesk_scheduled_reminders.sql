CREATE TABLE IF NOT EXISTS eventdesk_reminder_settings (
  department_id UUID PRIMARY KEY REFERENCES departments(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  delay_days INTEGER[] NOT NULL DEFAULT ARRAY[3,7,14],
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (cardinality(delay_days) BETWEEN 1 AND 10),
  CHECK (array_position(delay_days, NULL) IS NULL),
  CHECK (0 < ALL(delay_days))
);

ALTER TABLE eventdesk_documents
  ADD COLUMN IF NOT EXISTS reminders_paused BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS eventdesk_reminder_attempts (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  document_id UUID NOT NULL,
  attempt_no INTEGER NOT NULL CHECK (attempt_no BETWEEN 1 AND 10),
  delay_days INTEGER NOT NULL CHECK (delay_days > 0),
  recipient_email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  provider_message_id TEXT NOT NULL DEFAULT '',
  error_summary TEXT NOT NULL DEFAULT '',
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id, document_id, attempt_no),
  FOREIGN KEY (document_id, department_id) REFERENCES eventdesk_documents(id, department_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS eventdesk_reminder_attempts_history_idx
  ON eventdesk_reminder_attempts (department_id, document_id, attempt_no DESC);
