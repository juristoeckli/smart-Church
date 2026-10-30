CREATE TABLE IF NOT EXISTS eventdesk_job_history (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  job_id UUID NOT NULL,
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (char_length(action) BETWEEN 1 AND 60),
  details TEXT NOT NULL DEFAULT '' CHECK (char_length(details) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (job_id, department_id) REFERENCES eventdesk_jobs(id, department_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS eventdesk_job_history_recent_idx ON eventdesk_job_history(department_id,job_id,created_at DESC);
