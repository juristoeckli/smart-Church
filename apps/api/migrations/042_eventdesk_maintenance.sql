CREATE TABLE IF NOT EXISTS eventdesk_asset_maintenance (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 100000),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, department_id),
  FOREIGN KEY (asset_id, department_id) REFERENCES eventdesk_assets(id, department_id) ON DELETE CASCADE,
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS eventdesk_asset_maintenance_schedule_idx
  ON eventdesk_asset_maintenance (department_id, asset_id, starts_at, ends_at)
  WHERE status IN ('scheduled', 'in_progress');
