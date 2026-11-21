CREATE TABLE IF NOT EXISTS community_post_notification_preferences (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  notify_posts BOOLEAN NOT NULL DEFAULT true,
  notify_reactions BOOLEAN NOT NULL DEFAULT true,
  notify_comments BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(department_id,user_id)
);
