CREATE TABLE installation_http_settings (
  installation_id UUID PRIMARY KEY REFERENCES installations(id) ON DELETE CASCADE,
  access_mode TEXT NOT NULL DEFAULT 'none' CHECK (access_mode IN ('none', 'warning', 'redirect')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO installation_http_settings (installation_id)
SELECT id FROM installations WHERE is_current = TRUE
ON CONFLICT (installation_id) DO NOTHING;
