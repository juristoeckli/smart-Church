CREATE TABLE IF NOT EXISTS community_post_notifications (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('post', 'reaction', 'comment')),
  comment_id UUID REFERENCES community_post_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ,
  CHECK ((kind = 'comment') = (comment_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS community_post_notifications_unique_idx
  ON community_post_notifications(post_id,recipient_user_id,kind,actor_user_id,COALESCE(comment_id,'00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS community_post_notifications_inbox_idx
  ON community_post_notifications(department_id,recipient_user_id,created_at DESC);
