CREATE TABLE IF NOT EXISTS presenter_output_sessions (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL CHECK (session_id IN ('main', 'aux1', 'aux2', 'aux3', 'aux4', 'aux5', 'aux6', 'aux7', 'aux8', 'aux9', 'aux10')),
  display_name TEXT NOT NULL,
  token_hash TEXT UNIQUE,
  last_seen_at TIMESTAMPTZ,
  state JSONB NOT NULL DEFAULT '{"visible": false}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, session_id)
);

ALTER TABLE presenter_output_sessions ADD COLUMN IF NOT EXISTS token_hash TEXT;
ALTER TABLE presenter_output_sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE presenter_output_sessions ADD COLUMN IF NOT EXISTS state JSONB NOT NULL DEFAULT '{"visible": false}'::jsonb;
ALTER TABLE presenter_output_sessions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS presenter_output_sessions_token_hash_idx ON presenter_output_sessions(token_hash);
