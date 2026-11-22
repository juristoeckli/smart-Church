ALTER TABLE amx_site_settings
  ADD COLUMN IF NOT EXISTS webconsole_username TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS webconsole_password_ciphertext TEXT NOT NULL DEFAULT '';
