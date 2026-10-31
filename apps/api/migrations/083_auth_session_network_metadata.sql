ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS client_ip INET;

ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS dns_name TEXT;
