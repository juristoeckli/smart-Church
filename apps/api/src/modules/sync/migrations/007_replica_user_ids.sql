ALTER TABLE sync_site_redundancy
  ADD COLUMN IF NOT EXISTS replicated_user_ids UUID[] NOT NULL DEFAULT '{}'::UUID[];
