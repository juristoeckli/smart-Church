CREATE TABLE IF NOT EXISTS eventdesk_warehouses (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  address TEXT NOT NULL DEFAULT '',
  is_default BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, department_id),
  UNIQUE (department_id, name)
);

INSERT INTO eventdesk_warehouses (id, department_id, name, is_default)
SELECT gen_random_uuid(), d.id, 'Main warehouse', true
FROM departments d
WHERE 'eventdesk'=ANY(d.enabled_modules)
ON CONFLICT (department_id, name) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS eventdesk_warehouses_default_idx
  ON eventdesk_warehouses (department_id) WHERE is_default=true;

CREATE TABLE IF NOT EXISTS eventdesk_asset_warehouse_stock (
  department_id UUID NOT NULL,
  asset_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, asset_id, warehouse_id),
  FOREIGN KEY (asset_id, department_id) REFERENCES eventdesk_assets(id, department_id) ON DELETE CASCADE,
  FOREIGN KEY (warehouse_id, department_id) REFERENCES eventdesk_warehouses(id, department_id) ON DELETE RESTRICT
);

INSERT INTO eventdesk_asset_warehouse_stock (department_id, asset_id, warehouse_id, quantity)
SELECT a.department_id, a.id, w.id, a.quantity
FROM eventdesk_assets a JOIN eventdesk_warehouses w ON w.department_id=a.department_id AND w.is_default
ON CONFLICT (department_id, asset_id, warehouse_id) DO NOTHING;

ALTER TABLE eventdesk_job_assets ADD COLUMN IF NOT EXISTS warehouse_id UUID;
UPDATE eventdesk_job_assets b SET warehouse_id=w.id
FROM eventdesk_warehouses w
WHERE b.department_id=w.department_id AND w.is_default AND b.warehouse_id IS NULL;
ALTER TABLE eventdesk_job_assets ADD CONSTRAINT eventdesk_job_assets_warehouse_fk
  FOREIGN KEY (warehouse_id, department_id) REFERENCES eventdesk_warehouses(id, department_id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS eventdesk_asset_units (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  asset_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  serial_number TEXT NOT NULL CHECK (char_length(trim(serial_number)) BETWEEN 1 AND 120),
  barcode TEXT NOT NULL CHECK (char_length(trim(barcode)) BETWEEN 1 AND 120),
  condition TEXT NOT NULL DEFAULT 'good' CHECK (condition IN ('good','worn','damaged','retired')),
  status TEXT NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock','checked_out','maintenance','in_transit','retired')),
  transfer_id UUID,
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, department_id),
  UNIQUE (department_id, serial_number),
  UNIQUE (department_id, barcode),
  FOREIGN KEY (asset_id, department_id) REFERENCES eventdesk_assets(id, department_id) ON DELETE CASCADE,
  FOREIGN KEY (warehouse_id, department_id) REFERENCES eventdesk_warehouses(id, department_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS eventdesk_asset_units_lookup_idx ON eventdesk_asset_units (department_id, asset_id, warehouse_id, status);

CREATE TABLE IF NOT EXISTS eventdesk_job_asset_units (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  job_asset_id UUID NOT NULL,
  unit_id UUID NOT NULL,
  checked_out_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  returned_at TIMESTAMPTZ,
  FOREIGN KEY (job_asset_id, department_id) REFERENCES eventdesk_job_assets(id, department_id) ON DELETE CASCADE,
  FOREIGN KEY (unit_id, department_id) REFERENCES eventdesk_asset_units(id, department_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS eventdesk_job_asset_units_active_idx
  ON eventdesk_job_asset_units (department_id, unit_id) WHERE returned_at IS NULL;

CREATE TABLE IF NOT EXISTS eventdesk_asset_cases (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  barcode TEXT NOT NULL CHECK (char_length(trim(barcode)) BETWEEN 1 AND 120),
  warehouse_id UUID NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, department_id),
  UNIQUE (department_id, barcode),
  FOREIGN KEY (warehouse_id, department_id) REFERENCES eventdesk_warehouses(id, department_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS eventdesk_asset_case_items (
  department_id UUID NOT NULL,
  case_id UUID NOT NULL,
  asset_id UUID NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100000),
  PRIMARY KEY (department_id, case_id, asset_id),
  FOREIGN KEY (case_id, department_id) REFERENCES eventdesk_asset_cases(id, department_id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id, department_id) REFERENCES eventdesk_assets(id, department_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS eventdesk_asset_case_checks (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  case_id UUID NOT NULL,
  scanned_contents JSONB NOT NULL DEFAULT '[]'::jsonb,
  missing_contents JSONB NOT NULL DEFAULT '[]'::jsonb,
  substituted_contents JSONB NOT NULL DEFAULT '[]'::jsonb,
  checked_by UUID,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (case_id, department_id) REFERENCES eventdesk_asset_cases(id, department_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS eventdesk_warehouse_transfers (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  source_warehouse_id UUID NOT NULL,
  destination_warehouse_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_transit','received','cancelled')),
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1000),
  created_by UUID,
  dispatched_by UUID,
  received_by UUID,
  dispatched_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, department_id),
  FOREIGN KEY (source_warehouse_id, department_id) REFERENCES eventdesk_warehouses(id, department_id) ON DELETE RESTRICT,
  FOREIGN KEY (destination_warehouse_id, department_id) REFERENCES eventdesk_warehouses(id, department_id) ON DELETE RESTRICT,
  CHECK (source_warehouse_id <> destination_warehouse_id)
);
CREATE TABLE IF NOT EXISTS eventdesk_warehouse_transfer_lines (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  transfer_id UUID NOT NULL,
  asset_id UUID NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100000),
  UNIQUE (department_id, transfer_id, asset_id),
  FOREIGN KEY (transfer_id, department_id) REFERENCES eventdesk_warehouse_transfers(id, department_id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id, department_id) REFERENCES eventdesk_assets(id, department_id) ON DELETE RESTRICT
);
