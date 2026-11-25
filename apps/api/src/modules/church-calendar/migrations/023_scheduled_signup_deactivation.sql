ALTER TABLE church_calendar_signup_schedules
  ADD COLUMN deactivate_after_days integer,
  ADD CONSTRAINT church_calendar_signup_deactivation_check
    CHECK (deactivate_after_days IS NULL OR (auto_publish AND deactivate_after_days BETWEEN 0 AND 365));

CREATE TABLE church_calendar_signup_deactivations (
  group_id uuid PRIMARY KEY REFERENCES church_groups(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  deactivate_at timestamptz NOT NULL,
  signup_closes_at timestamptz NOT NULL CHECK (signup_closes_at <= deactivate_at),
  signup_token_hash text NOT NULL CHECK (signup_token_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX church_calendar_signup_deactivation_due ON church_calendar_signup_deactivations(deactivate_at, group_id);
