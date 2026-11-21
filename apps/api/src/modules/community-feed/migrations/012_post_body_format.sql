ALTER TABLE community_posts
  ADD COLUMN IF NOT EXISTS body_format TEXT NOT NULL DEFAULT 'plain'
  CHECK (body_format IN ('plain', 'formatted'));
