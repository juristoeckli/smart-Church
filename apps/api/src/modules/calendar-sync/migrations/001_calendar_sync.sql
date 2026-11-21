CREATE TABLE IF NOT EXISTS calendar_sync_preferences (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  event_kinds TEXT[] NOT NULL DEFAULT ARRAY['service','meeting','community','other']::TEXT[],
  feed_token_hash CHAR(64) NOT NULL UNIQUE,
  encrypted_feed_token TEXT NOT NULL DEFAULT '',
  feed_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id,user_id),
  CHECK (event_kinds <@ ARRAY['service','meeting','community','other']::TEXT[])
);

CREATE TABLE IF NOT EXISTS calendar_sync_connections (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google','microsoft')),
  account_email TEXT NOT NULL DEFAULT '',
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  calendar_name TEXT NOT NULL DEFAULT 'Calendar',
  encrypted_refresh_token TEXT NOT NULL,
  event_kinds TEXT[] NOT NULL DEFAULT ARRAY['service','meeting','community','other']::TEXT[],
  last_sync_at TIMESTAMPTZ,
  last_sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id,user_id,provider,calendar_id),
  CHECK (event_kinds <@ ARRAY['service','meeting','community','other']::TEXT[])
);
CREATE INDEX IF NOT EXISTS calendar_sync_connections_due_idx ON calendar_sync_connections (updated_at);

CREATE TABLE IF NOT EXISTS calendar_sync_event_links (
  connection_id UUID NOT NULL REFERENCES calendar_sync_connections(id) ON DELETE CASCADE,
  event_id UUID NOT NULL,
  remote_event_id TEXT NOT NULL,
  event_fingerprint CHAR(64) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id,event_id),
  UNIQUE (connection_id,remote_event_id)
);

CREATE TABLE IF NOT EXISTS calendar_sync_oauth_states (
  state_hash CHAR(64) PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google','microsoft')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calendar_sync_oauth_expiry_idx ON calendar_sync_oauth_states (expires_at);
