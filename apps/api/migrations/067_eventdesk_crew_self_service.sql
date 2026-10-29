CREATE TABLE IF NOT EXISTS eventdesk_crew_response_links (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  crew_id UUID NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  response TEXT CHECK (response IN ('confirmed','declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (crew_id,department_id) REFERENCES eventdesk_job_crew(id,department_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS eventdesk_crew_response_links_active_idx ON eventdesk_crew_response_links(department_id,crew_id,expires_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS eventdesk_crew_response_history (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  crew_id UUID NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL CHECK (to_status IN ('requested','assigned','invited','confirmed','declined')),
  changed_by UUID,
  actor_label TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '' CHECK (char_length(details) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (crew_id,department_id) REFERENCES eventdesk_job_crew(id,department_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS eventdesk_crew_response_history_idx ON eventdesk_crew_response_history(department_id,crew_id,created_at DESC);
