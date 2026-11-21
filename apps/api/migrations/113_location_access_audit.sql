CREATE TABLE IF NOT EXISTS location_access_audit (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL,
  actor_name TEXT NOT NULL,
  target_user_id UUID NOT NULL,
  target_name TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('granted','changed','revoked')),
  source TEXT NOT NULL CHECK (source IN ('location_access','server_accounts')),
  before_access JSONB,
  after_access JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (before_access IS NULL OR jsonb_typeof(before_access)='object'),
  CHECK (after_access IS NULL OR jsonb_typeof(after_access)='object'),
  CHECK ((action='granted' AND before_access IS NULL AND after_access IS NOT NULL)
      OR (action='changed' AND before_access IS NOT NULL AND after_access IS NOT NULL)
      OR (action='revoked' AND before_access IS NOT NULL AND after_access IS NULL))
);

CREATE INDEX IF NOT EXISTS location_access_audit_recent_idx
  ON location_access_audit(department_id,created_at DESC,id DESC);
