CREATE TABLE IF NOT EXISTS elvanto_people_export_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  source_person_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('create', 'update')),
  fields_sent JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(fields_sent) = 'array'),
  actor_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS elvanto_people_export_audit_recent_idx
  ON elvanto_people_export_audit(department_id, created_at DESC);

