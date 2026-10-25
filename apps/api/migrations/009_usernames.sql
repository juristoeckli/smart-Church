ALTER TABLE app_users ADD COLUMN username TEXT;

UPDATE app_users
   SET username = replace(id::text, '-', '')
 WHERE username IS NULL;

ALTER TABLE app_users ALTER COLUMN username SET NOT NULL;
ALTER TABLE app_users
  ADD CONSTRAINT app_users_username_format_check
  CHECK (username ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$');

CREATE UNIQUE INDEX app_users_username_lower_idx ON app_users (lower(username));
