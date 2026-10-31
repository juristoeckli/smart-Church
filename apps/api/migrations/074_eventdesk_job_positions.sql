BEGIN;

ALTER TABLE eventdesk_job_assets
  ADD COLUMN IF NOT EXISTS rate_factor_bps INTEGER NOT NULL DEFAULT 10000
  CHECK (rate_factor_bps BETWEEN 0 AND 1000000);

CREATE TABLE IF NOT EXISTS eventdesk_job_lines (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  job_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('sale','service','consumable')),
  description TEXT NOT NULL CHECK (char_length(trim(description)) BETWEEN 1 AND 240),
  quantity NUMERIC(10,3) NOT NULL CHECK (quantity > 0 AND quantity <= 100000),
  unit_label TEXT NOT NULL DEFAULT 'piece' CHECK (char_length(trim(unit_label)) BETWEEN 1 AND 32),
  unit_cents INTEGER NOT NULL CHECK (unit_cents BETWEEN 0 AND 100000000),
  unit_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents BETWEEN 0 AND 100000000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, department_id),
  FOREIGN KEY (job_id, department_id) REFERENCES eventdesk_jobs(id, department_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS eventdesk_job_lines_job_idx
  ON eventdesk_job_lines (department_id, job_id, created_at);

COMMIT;
