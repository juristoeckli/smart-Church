ALTER TABLE community_posts
  ADD COLUMN IF NOT EXISTS mentions_notified_at TIMESTAMPTZ;
