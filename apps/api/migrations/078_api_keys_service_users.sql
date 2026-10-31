ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS is_service_user BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS api_key_hash CHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS app_users_api_key_hash_idx
  ON app_users (api_key_hash)
  WHERE api_key_hash IS NOT NULL;

ALTER TABLE app_users
  DROP CONSTRAINT IF EXISTS app_users_server_permissions_check;

ALTER TABLE app_users
  ADD CONSTRAINT app_users_server_permissions_check
  CHECK (server_permissions <@ ARRAY['server_view', 'server_troubleshoot', 'server_manage', 'server_api']::TEXT[]);
