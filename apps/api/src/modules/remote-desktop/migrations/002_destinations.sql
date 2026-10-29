CREATE TABLE IF NOT EXISTS remote_desktop_site_settings (
  department_id UUID PRIMARY KEY REFERENCES departments(id) ON DELETE CASCADE,
  managed BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS remote_desktop_destinations (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  host TEXT NOT NULL CHECK (length(host) BETWEEN 1 AND 253),
  port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  protocol TEXT NOT NULL CHECK (protocol IN ('rdp', 'vnc', 'spice')),
  username TEXT NOT NULL DEFAULT '',
  password_ciphertext TEXT NOT NULL,
  password_iv TEXT NOT NULL,
  password_tag TEXT NOT NULL,
  autologin BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id, name)
);

CREATE INDEX IF NOT EXISTS remote_desktop_destinations_department_idx
  ON remote_desktop_destinations (department_id, name);

INSERT INTO remote_desktop_site_settings (department_id, managed)
SELECT id, false FROM departments
ON CONFLICT (department_id) DO NOTHING;
