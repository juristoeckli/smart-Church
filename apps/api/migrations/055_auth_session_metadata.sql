ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS user_agent TEXT NOT NULL DEFAULT 'Unknown browser';

ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS auth_sessions_user_active_idx
  ON auth_sessions (user_id, expires_at DESC, last_seen_at DESC);
