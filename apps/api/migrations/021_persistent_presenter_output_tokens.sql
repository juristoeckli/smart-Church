ALTER TABLE presenter_output_sessions ADD COLUMN IF NOT EXISTS output_token TEXT;
ALTER TABLE presenter_output_sessions ADD COLUMN IF NOT EXISTS previous_token_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS presenter_output_sessions_previous_token_hash_idx
  ON presenter_output_sessions(previous_token_hash)
  WHERE previous_token_hash IS NOT NULL;

COMMENT ON COLUMN presenter_output_sessions.output_token IS
  'Bearer credential for the corresponding Presenter display link; retained so links can be reissued unchanged.';
