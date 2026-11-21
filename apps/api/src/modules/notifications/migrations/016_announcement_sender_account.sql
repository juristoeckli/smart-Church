ALTER TABLE module_notification_announcement_batches
  ADD COLUMN IF NOT EXISTS sender_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_announcement_batches_sender
  ON module_notification_announcement_batches (department_id, sender_user_id, sent_at DESC, id DESC)
  WHERE sender_user_id IS NOT NULL;
