CREATE TABLE IF NOT EXISTS churchtools_migration_group_structure (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  instance_url TEXT NOT NULL,
  source_group_id TEXT NOT NULL CHECK (source_group_id ~ '^[1-9][0-9]{0,15}$'),
  source_group_guid UUID NOT NULL,
  group_id UUID NOT NULL UNIQUE REFERENCES church_groups(id) ON DELETE CASCADE,
  imported_type_id TEXT,
  imported_parent_id TEXT,
  PRIMARY KEY (department_id,instance_url,source_group_id),
  UNIQUE (department_id,instance_url,source_group_guid)
);
