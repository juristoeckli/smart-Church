CREATE TABLE IF NOT EXISTS installation_modules (
  installation_id UUID NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL CHECK (module_id ~ '^[a-z0-9][a-z0-9-]*$'),
  version TEXT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  client_managed BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, module_id)
);

INSERT INTO installation_modules (installation_id, module_id, enabled, required, client_managed)
SELECT department.installation_id,
       enabled.module_id,
       TRUE,
       enabled.module_id IN ('file-storage', 'notifications'),
       TRUE
  FROM departments AS department
 CROSS JOIN LATERAL unnest(department.enabled_modules) AS enabled(module_id)
 GROUP BY department.installation_id, enabled.module_id
ON CONFLICT (installation_id, module_id) DO NOTHING;

INSERT INTO installation_modules (installation_id, module_id, enabled, required, client_managed)
SELECT installation.id, required.module_id, TRUE, TRUE, TRUE
  FROM installations AS installation
 CROSS JOIN (VALUES ('file-storage'), ('notifications')) AS required(module_id)
ON CONFLICT (installation_id, module_id) DO UPDATE
   SET enabled = TRUE,
       required = TRUE,
       updated_at = now();

-- Sync is a client-only built-in module and is enabled by default.
INSERT INTO installation_modules (installation_id, module_id, enabled, client_managed)
SELECT id, 'sync', TRUE, TRUE FROM installations
ON CONFLICT (installation_id, module_id) DO NOTHING;

UPDATE departments AS department
   SET enabled_modules = COALESCE((
     SELECT array_agg(module.module_id ORDER BY module.module_id)
       FROM installation_modules AS module
      WHERE module.installation_id = department.installation_id
        AND module.client_managed = TRUE
        AND module.enabled = TRUE
   ), ARRAY['file-storage', 'notifications']::TEXT[]),
       updated_at = now();
