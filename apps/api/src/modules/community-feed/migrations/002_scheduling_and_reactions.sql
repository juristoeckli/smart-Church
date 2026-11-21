ALTER TABLE community_posts
  ADD COLUMN IF NOT EXISTS publish_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS comments_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS group_id UUID,
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'location';

ALTER TABLE community_post_likes
  ADD COLUMN IF NOT EXISTS reaction_type TEXT NOT NULL DEFAULT 'like';

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'community_post_likes_reaction_type_check'
       AND conrelid = 'community_post_likes'::regclass
  ) THEN
    ALTER TABLE community_post_likes
      ADD CONSTRAINT community_post_likes_reaction_type_check
      CHECK (reaction_type IN ('like','love','pray','celebrate'));
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS community_posts_department_publish_idx
  ON community_posts (department_id, publish_at);

CREATE INDEX IF NOT EXISTS community_posts_group_visibility_idx
  ON community_posts (department_id, group_id, visibility, created_at DESC);

CREATE TABLE IF NOT EXISTS community_post_hidden (
  post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  hidden_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id,user_id)
);

CREATE TABLE IF NOT EXISTS community_post_subscriptions (
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES church_groups(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,group_id)
);

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'community_posts_visibility_check'
       AND conrelid = 'community_posts'::regclass
  ) THEN
    ALTER TABLE community_posts
      ADD CONSTRAINT community_posts_visibility_check
      CHECK (visibility IN ('location','members') AND (visibility='location' OR group_id IS NOT NULL));
  END IF;
END
$migration$;
