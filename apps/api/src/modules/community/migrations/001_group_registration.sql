ALTER TABLE church_groups
  ADD COLUMN IF NOT EXISTS public_signup_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_signup_token UUID UNIQUE;

CREATE TABLE IF NOT EXISTS group_join_requests (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES church_groups(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL CHECK (length(trim(first_name)) BETWEEN 1 AND 80),
  last_name TEXT NOT NULL CHECK (length(trim(last_name)) BETWEEN 1 AND 80),
  email TEXT NOT NULL CHECK (length(trim(email)) BETWEEN 3 AND 254),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS group_join_requests_pending_email_idx
  ON group_join_requests (group_id, lower(email)) WHERE status='pending';
CREATE INDEX IF NOT EXISTS group_join_requests_department_status_idx
  ON group_join_requests (department_id,status,created_at DESC);
