ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS menu_preferences JSONB;
