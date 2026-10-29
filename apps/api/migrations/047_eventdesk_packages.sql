CREATE TABLE IF NOT EXISTS eventdesk_packages (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, department_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS eventdesk_packages_department_name_idx
  ON eventdesk_packages (department_id, lower(name));

CREATE TABLE IF NOT EXISTS eventdesk_package_items (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  package_id UUID NOT NULL,
  asset_id UUID NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100000),
  PRIMARY KEY (package_id, asset_id),
  FOREIGN KEY (package_id, department_id) REFERENCES eventdesk_packages(id, department_id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id, department_id) REFERENCES eventdesk_assets(id, department_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS eventdesk_package_items_asset_idx
  ON eventdesk_package_items (department_id, asset_id);
