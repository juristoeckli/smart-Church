CREATE TABLE IF NOT EXISTS elvanto_sync_settings (
  department_id UUID PRIMARY KEY REFERENCES departments(id) ON DELETE CASCADE,
  encrypted_api_key TEXT NOT NULL,
  directions JSONB NOT NULL DEFAULT '{}'::jsonb,
  financial_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  last_connected_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  last_sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
