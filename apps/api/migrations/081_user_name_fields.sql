ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT;

UPDATE app_users
   SET first_name = COALESCE(NULLIF(first_name, ''), split_part(trim(display_name), ' ', 1)),
       last_name = COALESCE(NULLIF(last_name, ''), CASE
         WHEN position(' ' in trim(display_name)) > 0
         THEN NULLIF(trim(substring(trim(display_name) from position(' ' in trim(display_name)) + 1)), '')
       END)
 WHERE is_service_user = false;

UPDATE app_users
   SET first_name = NULL,
       last_name = NULL,
       email = NULL
 WHERE is_service_user = true;
