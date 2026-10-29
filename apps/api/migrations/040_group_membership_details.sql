ALTER TABLE group_members
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'Member' CHECK (length(trim(role)) BETWEEN 1 AND 80),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'waitlist')),
  ADD COLUMN IF NOT EXISTS joined_on DATE;

CREATE INDEX IF NOT EXISTS group_members_group_status_idx ON group_members (group_id, status, added_at);
