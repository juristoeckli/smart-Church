CREATE TABLE IF NOT EXISTS eventdesk_purchase_orders (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  reference TEXT NOT NULL,
  supplier_id UUID NOT NULL,
  job_id UUID,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','ordered','partially_received','received','cancelled')),
  expected_delivery_date DATE,
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
  created_by UUID,
  approved_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id,department_id),
  UNIQUE (department_id,reference),
  FOREIGN KEY (supplier_id,department_id) REFERENCES eventdesk_partners(id,department_id) ON DELETE RESTRICT,
  FOREIGN KEY (job_id,department_id) REFERENCES eventdesk_jobs(id,department_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS eventdesk_purchase_orders_location_status_idx ON eventdesk_purchase_orders(department_id,status,expected_delivery_date);

CREATE TABLE IF NOT EXISTS eventdesk_purchase_order_lines (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  purchase_order_id UUID NOT NULL,
  asset_id UUID,
  description TEXT NOT NULL CHECK (char_length(trim(description)) BETWEEN 1 AND 240),
  quantity_ordered INTEGER NOT NULL CHECK (quantity_ordered BETWEEN 1 AND 100000),
  quantity_received INTEGER NOT NULL DEFAULT 0 CHECK (quantity_received BETWEEN 0 AND 100000),
  quantity_cancelled INTEGER NOT NULL DEFAULT 0 CHECK (quantity_cancelled BETWEEN 0 AND 100000),
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents BETWEEN 0 AND 1000000000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id,department_id),
  FOREIGN KEY (purchase_order_id,department_id) REFERENCES eventdesk_purchase_orders(id,department_id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id,department_id) REFERENCES eventdesk_assets(id,department_id) ON DELETE RESTRICT,
  CHECK (quantity_received + quantity_cancelled <= quantity_ordered)
);
CREATE INDEX IF NOT EXISTS eventdesk_purchase_order_lines_idx ON eventdesk_purchase_order_lines(department_id,purchase_order_id);

CREATE TABLE IF NOT EXISTS eventdesk_subrentals (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  job_id UUID NOT NULL,
  supplier_id UUID NOT NULL,
  asset_id UUID NOT NULL,
  supplier_item TEXT NOT NULL CHECK (char_length(trim(supplier_item)) BETWEEN 1 AND 240),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100000),
  quantity_checked_out INTEGER NOT NULL DEFAULT 0 CHECK (quantity_checked_out BETWEEN 0 AND 100000),
  quantity_returned INTEGER NOT NULL DEFAULT 0 CHECK (quantity_returned BETWEEN 0 AND 100000),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  daily_cost_cents INTEGER NOT NULL CHECK (daily_cost_cents BETWEEN 0 AND 1000000000),
  supplier_charges_cents INTEGER NOT NULL DEFAULT 0 CHECK (supplier_charges_cents BETWEEN 0 AND 1000000000),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','checked_out','partially_returned','returned','cancelled')),
  return_notes TEXT NOT NULL DEFAULT '' CHECK (char_length(return_notes) <= 2000),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id,department_id),
  FOREIGN KEY (job_id,department_id) REFERENCES eventdesk_jobs(id,department_id) ON DELETE RESTRICT,
  FOREIGN KEY (supplier_id,department_id) REFERENCES eventdesk_partners(id,department_id) ON DELETE RESTRICT,
  FOREIGN KEY (asset_id,department_id) REFERENCES eventdesk_assets(id,department_id) ON DELETE RESTRICT,
  CHECK (ends_at > starts_at),
  CHECK (quantity_checked_out <= quantity),
  CHECK (quantity_returned <= quantity_checked_out)
);
CREATE INDEX IF NOT EXISTS eventdesk_subrentals_asset_period_idx ON eventdesk_subrentals(department_id,asset_id,starts_at,ends_at) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS eventdesk_subrentals_job_idx ON eventdesk_subrentals(department_id,job_id,status);

CREATE TABLE IF NOT EXISTS eventdesk_subrental_allocations (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  subrental_id UUID NOT NULL,
  job_asset_id UUID NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id,subrental_id,job_asset_id),
  FOREIGN KEY (subrental_id,department_id) REFERENCES eventdesk_subrentals(id,department_id) ON DELETE CASCADE,
  FOREIGN KEY (job_asset_id,department_id) REFERENCES eventdesk_job_assets(id,department_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS eventdesk_procurement_documents (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  purchase_order_id UUID,
  subrental_id UUID,
  file_name TEXT NOT NULL CHECK (char_length(trim(file_name)) BETWEEN 1 AND 240),
  media_type TEXT NOT NULL CHECK (media_type IN ('application/pdf','image/jpeg','image/png')),
  file_data BYTEA NOT NULL,
  uploaded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((purchase_order_id IS NULL) <> (subrental_id IS NULL)),
  FOREIGN KEY (purchase_order_id,department_id) REFERENCES eventdesk_purchase_orders(id,department_id) ON DELETE CASCADE,
  FOREIGN KEY (subrental_id,department_id) REFERENCES eventdesk_subrentals(id,department_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS eventdesk_procurement_documents_idx ON eventdesk_procurement_documents(department_id,created_at DESC);

CREATE TABLE IF NOT EXISTS eventdesk_supply_status_history (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('purchase_order','subrental')),
  entity_id UUID NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '' CHECK (char_length(details) <= 1000),
  changed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eventdesk_supply_status_history_idx ON eventdesk_supply_status_history(department_id,entity_kind,entity_id,created_at);
