CREATE TABLE IF NOT EXISTS sync_site_redundancy (
  department_id UUID PRIMARY KEY REFERENCES departments(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('primary','standby','fenced')),
  primary_installation_id UUID NOT NULL,
  upstream_installation_id UUID,
  upstream_department_id UUID,
  site_epoch BIGINT NOT NULL DEFAULT 1 CHECK (site_epoch > 0),
  last_snapshot_id UUID,
  last_snapshot_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  last_error TEXT,
  promoted_at TIMESTAMPTZ,
  fenced_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO sync_site_redundancy(department_id,role,primary_installation_id)
SELECT department.id,'primary',department.installation_id FROM departments department
ON CONFLICT(department_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS sync_redundancy_imports (
  snapshot_id UUID PRIMARY KEY,
  source_installation_id UUID NOT NULL,
  source_department_id UUID NOT NULL,
  target_department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  source_epoch BIGINT NOT NULL CHECK (source_epoch > 0),
  chunk_count INTEGER NOT NULL CHECK (chunk_count BETWEEN 1 AND 10000),
  byte_count BIGINT NOT NULL CHECK (byte_count BETWEEN 1 AND 1073741824),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  module_manifest JSONB NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('receiving','applied','rejected')),
  received_chunks INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_redundancy_chunks (
  snapshot_id UUID NOT NULL REFERENCES sync_redundancy_imports(snapshot_id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  chunk_data BYTEA NOT NULL,
  PRIMARY KEY(snapshot_id,chunk_index)
);

CREATE TABLE IF NOT EXISTS sync_redundancy_audit (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('standby_configured','snapshot_applied','promotion_started','promoted','fenced','rejoined')),
  old_epoch BIGINT,
  new_epoch BIGINT,
  source_installation_id UUID,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sync_redundancy_import_expiry_idx ON sync_redundancy_imports(expires_at) WHERE state='receiving';
