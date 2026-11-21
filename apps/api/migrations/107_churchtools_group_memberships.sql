CREATE TABLE IF NOT EXISTS churchtools_migration_membership_details (
  department_id UUID NOT NULL REFERENCES churchtools_sync_settings(department_id) ON DELETE CASCADE,
  instance_url TEXT NOT NULL,
  source_group_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  group_id UUID NOT NULL REFERENCES church_groups(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  encrypted_snapshot TEXT NOT NULL,
  last_role TEXT,
  last_status TEXT,
  last_joined_on DATE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, instance_url, source_group_id, source_id)
);

CREATE INDEX IF NOT EXISTS churchtools_migration_membership_details_group_idx
  ON churchtools_migration_membership_details (group_id);

CREATE INDEX IF NOT EXISTS churchtools_migration_membership_details_contact_idx
  ON churchtools_migration_membership_details (contact_id);
