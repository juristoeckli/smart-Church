CREATE TABLE IF NOT EXISTS elvanto_sync_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  area TEXT NOT NULL CHECK (area IN ('people','people_flows','groups','services','songs','calendar','financial')),
  action TEXT NOT NULL CHECK (action IN ('preview', 'import', 'export', 'permission_check')),
  outcome TEXT NOT NULL CHECK (outcome IN ('complete', 'incomplete', 'success', 'failed', 'conflict')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS elvanto_sync_audit_department_created_idx
  ON elvanto_sync_audit (department_id, created_at DESC);
