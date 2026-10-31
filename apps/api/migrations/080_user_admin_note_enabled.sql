ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS admin_note TEXT,
  ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE app_users
  ADD CONSTRAINT app_users_admin_note_length_check
  CHECK (admin_note IS NULL OR length(admin_note) <= 2000);
