ALTER TABLE app_users
  ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;
