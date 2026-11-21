CREATE TABLE IF NOT EXISTS community_post_attachments (
  id UUID PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL CHECK (length(filename) BETWEEN 1 AND 180),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/gif','image/webp','application/pdf','text/plain')),
  content BYTEA NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 1048576),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(department_id,id)
);
CREATE INDEX IF NOT EXISTS community_post_attachments_post_idx ON community_post_attachments(department_id,post_id,created_at);

CREATE TABLE IF NOT EXISTS community_post_links (
  post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK (link_type IN ('person','group','wiki','song')),
  entity_id UUID NOT NULL,
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 180),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(post_id,link_type,entity_id)
);
CREATE INDEX IF NOT EXISTS community_post_links_post_idx ON community_post_links(department_id,post_id);
