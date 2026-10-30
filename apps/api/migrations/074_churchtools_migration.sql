CREATE TABLE IF NOT EXISTS churchtools_migration_snapshots (
  department_id UUID PRIMARY KEY REFERENCES departments(id) ON DELETE CASCADE,
  encrypted_snapshot TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  preview_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  page INTEGER NOT NULL DEFAULT 0 CHECK (page >= 0),
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  created_count INTEGER NOT NULL DEFAULT 0 CHECK (created_count >= 0),
  updated_count INTEGER NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
  skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  complete BOOLEAN NOT NULL DEFAULT FALSE,
  migration_running BOOLEAN NOT NULL DEFAULT FALSE,
  migration_started_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS churchtools_migration_links (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  area TEXT NOT NULL CHECK (area IN ('person', 'group', 'event', 'resource')),
  source_id TEXT NOT NULL,
  local_record_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, area, source_id),
  UNIQUE (department_id, area, local_record_id)
);
