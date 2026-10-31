ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS service_user_owner_id UUID REFERENCES app_users(id) ON DELETE SET NULL;
