CREATE TABLE IF NOT EXISTS installation_branding (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  logo_mime_type TEXT CHECK (logo_mime_type IS NULL OR logo_mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  logo_data BYTEA,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((logo_mime_type IS NULL) = (logo_data IS NULL))
);
