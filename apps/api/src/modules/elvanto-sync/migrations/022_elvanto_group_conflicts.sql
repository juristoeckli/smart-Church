CREATE TABLE IF NOT EXISTS elvanto_group_sync_state (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  baseline JSONB CHECK (baseline IS NULL OR jsonb_typeof(baseline)='object'),
  pending_preview_at TIMESTAMPTZ,
  pending_local JSONB CHECK (pending_local IS NULL OR jsonb_typeof(pending_local)='object'),
  pending_remote JSONB CHECK (pending_remote IS NULL OR jsonb_typeof(pending_remote)='object'),
  pending_remote_hash TEXT,
  requires_review BOOLEAN NOT NULL DEFAULT FALSE,
  resolution TEXT CHECK (resolution IS NULL OR resolution IN ('use_elvanto','keep_local')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id,source_id),
  CHECK ((pending_remote IS NULL AND pending_local IS NULL AND pending_remote_hash IS NULL AND pending_preview_at IS NULL AND resolution IS NULL AND requires_review=FALSE)
    OR (pending_remote IS NOT NULL AND pending_local IS NOT NULL AND pending_remote_hash IS NOT NULL AND pending_preview_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS elvanto_group_sync_state_pending_idx
  ON elvanto_group_sync_state (department_id,pending_preview_at,source_id)
  WHERE requires_review=TRUE AND pending_remote IS NOT NULL;
