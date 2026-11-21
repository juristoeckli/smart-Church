CREATE TABLE IF NOT EXISTS people_record_merges (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  keeper_contact_id UUID NOT NULL,
  merged_contact_id UUID NOT NULL,
  actor_user_id UUID,
  source_snapshot JSONB NOT NULL CHECK (jsonb_typeof(source_snapshot)='object'),
  profile_conflicts_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(keeper_contact_id,department_id) REFERENCES contacts(id,department_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS people_record_merges_keeper_idx
  ON people_record_merges(department_id,keeper_contact_id,created_at DESC);
