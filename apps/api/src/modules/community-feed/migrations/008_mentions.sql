ALTER TABLE community_post_notifications DROP CONSTRAINT IF EXISTS community_post_notifications_kind_check;
ALTER TABLE community_post_notifications ADD CONSTRAINT community_post_notifications_kind_check
  CHECK (kind IN ('post','reaction','comment','mention'));

CREATE TABLE IF NOT EXISTS community_post_mentions (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, post_id, contact_id)
);
