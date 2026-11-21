CREATE TABLE IF NOT EXISTS churchtools_migration_service_templates (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  instance_url TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('event','agenda')),
  source_id TEXT NOT NULL CHECK (source_id ~ '^[1-9][0-9]{0,15}$'),
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  template_id UUID NOT NULL UNIQUE REFERENCES service_plan_templates(id) ON DELETE RESTRICT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id,instance_url,kind,source_id)
);
