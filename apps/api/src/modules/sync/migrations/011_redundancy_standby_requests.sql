CREATE TABLE IF NOT EXISTS sync_redundancy_standby_requests (
  id UUID PRIMARY KEY,
  source_installation_id UUID NOT NULL,
  source_department_id UUID NOT NULL,
  target_department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  source_epoch BIGINT NOT NULL CHECK (source_epoch > 0),
  source_department_name TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','approved','rejected','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sync_redundancy_pending_request_idx
  ON sync_redundancy_standby_requests(source_installation_id,source_department_id,target_department_id)
  WHERE state='pending';

CREATE INDEX IF NOT EXISTS sync_redundancy_target_request_idx
  ON sync_redundancy_standby_requests(target_department_id,state,created_at DESC);
