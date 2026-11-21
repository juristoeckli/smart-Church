ALTER TABLE community_post_notification_preferences
  ADD COLUMN IF NOT EXISTS notify_email_posts BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_email_reactions BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_email_comments BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE community_post_notifications
  ADD COLUMN IF NOT EXISTS in_app_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN NOT NULL DEFAULT true;
