CREATE TABLE IF NOT EXISTS email_worker_department_settings (
  department_id UUID PRIMARY KEY REFERENCES departments(id) ON DELETE CASCADE,
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

INSERT INTO email_worker_department_settings
  (department_id,mode,enabled,from_name,from_email,smtp_host,smtp_port,smtp_security,smtp_username,encrypted_smtp_password,updated_at)
SELECT department.id,settings.mode,settings.enabled,settings.from_name,settings.from_email,settings.smtp_host,settings.smtp_port,
       settings.smtp_security,settings.smtp_username,settings.encrypted_smtp_password,settings.updated_at
  FROM departments department
  JOIN installations installation ON installation.id=department.installation_id AND installation.is_current=TRUE
  JOIN installation_email_settings settings ON settings.installation_id=installation.id
ON CONFLICT (department_id) DO NOTHING;
