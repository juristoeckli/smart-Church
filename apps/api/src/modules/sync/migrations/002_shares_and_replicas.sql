CREATE TABLE IF NOT EXISTS sync_share_grants (
  id UUID PRIMARY KEY,
  owner_department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  recipient_installation_id UUID NOT NULL,
  recipient_department_id UUID,
  scopes TEXT[] NOT NULL CHECK (cardinality(scopes) > 0 AND scopes <@ ARRAY['people_names','services']::TEXT[]),
  delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('pull','push')),
  state TEXT NOT NULL CHECK (state IN ('active','revoked')),
  revision BIGINT NOT NULL DEFAULT 1,
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  last_pushed_at TIMESTAMPTZ,
  last_push_error TEXT,
  UNIQUE(id, recipient_installation_id)
);
CREATE INDEX IF NOT EXISTS sync_share_grants_recipient_idx ON sync_share_grants(recipient_installation_id, state);

CREATE TABLE IF NOT EXISTS sync_subscriptions (
  id UUID PRIMARY KEY,
  source_installation_id UUID NOT NULL,
  source_grant_id UUID NOT NULL,
  recipient_department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  scopes TEXT[] NOT NULL CHECK (cardinality(scopes) > 0 AND scopes <@ ARRAY['people_names','services']::TEXT[]),
  delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('pull','push')),
  state TEXT NOT NULL CHECK (state IN ('pending','active','rejected','revoked')),
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  current_run_id UUID,
  sync_started_at TIMESTAMPTZ,
  source_revision BIGINT,
  last_snapshot_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_installation_id, source_grant_id, recipient_department_id)
);
CREATE INDEX IF NOT EXISTS sync_subscriptions_department_idx ON sync_subscriptions(recipient_department_id, state);

CREATE TABLE IF NOT EXISTS sync_replica_staging (
  run_id UUID NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('people_names','services')),
  source_id UUID NOT NULL,
  source_revision TEXT NOT NULL,
  record JSONB NOT NULL,
  PRIMARY KEY(run_id, scope, source_id)
);
CREATE INDEX IF NOT EXISTS sync_replica_staging_run_idx ON sync_replica_staging(run_id);

CREATE TABLE IF NOT EXISTS sync_replica_push_runs (
  subscription_id UUID NOT NULL REFERENCES sync_subscriptions(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL,
  source_revision BIGINT NOT NULL,
  total_records INTEGER NOT NULL,
  next_offset INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(subscription_id, snapshot_id)
);

CREATE TABLE IF NOT EXISTS sync_replica_records (
  subscription_id UUID NOT NULL REFERENCES sync_subscriptions(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('people_names','services')),
  source_id UUID NOT NULL,
  source_revision TEXT NOT NULL,
  record JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(subscription_id, scope, source_id)
);
CREATE INDEX IF NOT EXISTS sync_replica_records_scope_idx ON sync_replica_records(subscription_id, scope);

CREATE TABLE IF NOT EXISTS sync_export_snapshots (
  id UUID PRIMARY KEY,
  grant_id UUID NOT NULL REFERENCES sync_share_grants(id) ON DELETE CASCADE,
  recipient_installation_id UUID NOT NULL,
  grant_revision BIGINT NOT NULL,
  records JSONB NOT NULL,
  record_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sync_export_snapshots_expiry_idx ON sync_export_snapshots(expires_at);
