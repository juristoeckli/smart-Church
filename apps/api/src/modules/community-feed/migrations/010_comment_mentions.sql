ALTER TABLE community_post_notifications DROP CONSTRAINT IF EXISTS community_post_notifications_check;
ALTER TABLE community_post_notifications
  ADD CONSTRAINT community_post_notifications_comment_id_check
  CHECK (
    (kind = 'comment' AND comment_id IS NOT NULL)
    OR kind = 'mention'
    OR (kind NOT IN ('comment', 'mention') AND comment_id IS NULL)
  );

CREATE TABLE IF NOT EXISTS community_comment_mentions (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  comment_id UUID NOT NULL REFERENCES community_post_comments(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, comment_id, contact_id)
);

CREATE INDEX IF NOT EXISTS community_comment_mentions_post_idx
  ON community_comment_mentions(department_id, post_id, comment_id);
