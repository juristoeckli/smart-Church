ALTER TABLE churchtools_migration_membership_details
  ADD COLUMN IF NOT EXISTS encrypted_custom_snapshot TEXT;
