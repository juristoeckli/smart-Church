ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS server_permissions TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

ALTER TABLE app_users
  DROP CONSTRAINT IF EXISTS app_users_server_permissions_check;

ALTER TABLE app_users
  ADD CONSTRAINT app_users_server_permissions_check
  CHECK (server_permissions <@ ARRAY['server_view', 'server_troubleshoot', 'server_manage']::TEXT[]);
