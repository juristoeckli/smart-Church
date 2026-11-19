ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

UPDATE app_users account
   SET last_active_at = activity.last_seen_at
  FROM (
    SELECT user_id, max(last_seen_at) AS last_seen_at
      FROM auth_sessions
     GROUP BY user_id
  ) activity
 WHERE account.id = activity.user_id;
