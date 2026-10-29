CREATE TABLE IF NOT EXISTS eventdesk_supplier_rate_cards (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 160),
  valid_from DATE NOT NULL,
  valid_to DATE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, department_id),
  FOREIGN KEY (supplier_id, department_id) REFERENCES eventdesk_partners(id, department_id) ON DELETE RESTRICT,
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE INDEX IF NOT EXISTS eventdesk_supplier_rate_cards_lookup_idx
  ON eventdesk_supplier_rate_cards (department_id, supplier_id, active, valid_from, valid_to);

CREATE TABLE IF NOT EXISTS eventdesk_supplier_rate_lines (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  rate_card_id UUID NOT NULL,
  asset_id UUID,
  category TEXT,
  daily_rate_cents INTEGER NOT NULL CHECK (daily_rate_cents BETWEEN 0 AND 100000000),
  FOREIGN KEY (rate_card_id, department_id) REFERENCES eventdesk_supplier_rate_cards(id, department_id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id, department_id) REFERENCES eventdesk_assets(id, department_id) ON DELETE CASCADE,
  CHECK ((asset_id IS NOT NULL) <> (category IS NOT NULL)),
  CHECK (category IS NULL OR char_length(trim(category)) BETWEEN 1 AND 80)
);

CREATE UNIQUE INDEX IF NOT EXISTS eventdesk_supplier_rate_asset_unique_idx
  ON eventdesk_supplier_rate_lines (department_id, rate_card_id, asset_id)
  WHERE asset_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS eventdesk_supplier_rate_category_unique_idx
  ON eventdesk_supplier_rate_lines (department_id, rate_card_id, lower(category))
  WHERE category IS NOT NULL;

ALTER TABLE eventdesk_jobs
  ADD COLUMN IF NOT EXISTS supplier_rate_card_id UUID;
ALTER TABLE eventdesk_jobs
  ADD CONSTRAINT eventdesk_jobs_rate_card_department_fk
  FOREIGN KEY (supplier_rate_card_id, department_id)
  REFERENCES eventdesk_supplier_rate_cards(id, department_id) ON DELETE RESTRICT;

ALTER TABLE eventdesk_packages
  ADD COLUMN IF NOT EXISTS discount_bps INTEGER NOT NULL DEFAULT 0 CHECK (discount_bps BETWEEN 0 AND 10000);
