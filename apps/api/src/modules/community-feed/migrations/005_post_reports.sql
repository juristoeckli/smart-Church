CREATE TABLE IF NOT EXISTS community_post_reports (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  reporter_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('spam','inappropriate','harmful','other')),
  details TEXT NOT NULL DEFAULT '' CHECK (length(details) <= 500),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','actioned')),
  reviewed_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(post_id, reporter_user_id)
);

CREATE INDEX IF NOT EXISTS community_post_reports_queue_idx
  ON community_post_reports(department_id, status, created_at DESC);
