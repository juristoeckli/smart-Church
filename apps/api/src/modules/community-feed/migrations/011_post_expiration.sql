ALTER TABLE community_posts
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS community_posts_expiration_due_idx
  ON community_posts(expires_at, id)
  WHERE expires_at IS NOT NULL AND expired_at IS NULL;

CREATE TABLE IF NOT EXISTS community_post_lifecycle_audit (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('expiry_scheduled','expiry_changed','expiry_cancelled','expired')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_post_lifecycle_audit_post_idx
  ON community_post_lifecycle_audit(department_id, post_id, created_at);
