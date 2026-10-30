-- Retain the prior primary relationship after promotion. A former primary
-- behind NAT can then authenticate an outbound snapshot pull to the new
-- primary when it rejoins as a standby.
ALTER TABLE sync_site_redundancy
  ADD COLUMN IF NOT EXISTS former_standby_installation_id UUID,
  ADD COLUMN IF NOT EXISTS former_standby_department_id UUID;
