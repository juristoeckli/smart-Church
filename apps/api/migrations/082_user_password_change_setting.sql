ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS can_change_password BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE app_users
   SET can_change_password = false
 WHERE is_service_user = true;
