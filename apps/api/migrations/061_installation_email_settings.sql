CREATE TABLE installation_email_settings (
  installation_id UUID PRIMARY KEY REFERENCES installations(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'direct' CHECK (mode IN ('direct', 'smtp')),
  enabled BOOLEAN NOT NULL DEFAULT false,
  from_name TEXT NOT NULL DEFAULT 'Smart Church',
  from_email TEXT NOT NULL DEFAULT '',
  smtp_host TEXT NOT NULL DEFAULT '',
  smtp_port INTEGER NOT NULL DEFAULT 587 CHECK (smtp_port BETWEEN 1 AND 65535),
  smtp_security TEXT NOT NULL DEFAULT 'starttls' CHECK (smtp_security IN ('none', 'starttls', 'tls')),
  smtp_username TEXT NOT NULL DEFAULT '',
  encrypted_smtp_password TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
