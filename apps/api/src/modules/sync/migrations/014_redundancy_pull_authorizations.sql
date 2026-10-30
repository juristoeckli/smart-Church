CREATE TABLE IF NOT EXISTS sync_redundancy_pull_authorizations (
  id UUID PRIMARY KEY,
  source_department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  target_installation_id UUID NOT NULL,
  target_department_id UUID NOT NULL,
  target_department_name TEXT NOT NULL,
  source_epoch BIGINT NOT NULL CHECK (source_epoch > 0),
  state TEXT NOT NULL CHECK (state IN ('pending','approved','rejected','revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sync_redundancy_pull_authorizations_pending_idx
  ON sync_redundancy_pull_authorizations(source_department_id,target_installation_id,target_department_id)
  WHERE state IN ('pending','approved');

CREATE INDEX IF NOT EXISTS sync_redundancy_pull_authorizations_site_idx
  ON sync_redundancy_pull_authorizations(source_department_id,state,created_at DESC);

ALTER TABLE sync_redundancy_audit
  DROP CONSTRAINT IF EXISTS sync_redundancy_audit_action_check;
ALTER TABLE sync_redundancy_audit
  ADD CONSTRAINT sync_redundancy_audit_action_check
  CHECK (action IN ('standby_configured','snapshot_applied','promotion_started','promoted','fenced','rejoined','standby_pull_approved','standby_pull_rejected'));
