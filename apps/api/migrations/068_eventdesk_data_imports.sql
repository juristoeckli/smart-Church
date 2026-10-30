CREATE TABLE IF NOT EXISTS eventdesk_import_previews (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  entity TEXT NOT NULL CHECK (entity IN ('customers','equipment','suppliers','venues','freelancers','jobs')),
  rows_json JSONB NOT NULL,
  created_by UUID,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '30 minutes',
  committed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eventdesk_import_previews_active_idx ON eventdesk_import_previews(department_id,expires_at) WHERE committed_at IS NULL;
