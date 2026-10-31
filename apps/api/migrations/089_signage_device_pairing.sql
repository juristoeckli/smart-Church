CREATE TABLE signage_pairing_sessions (
  token_hash TEXT PRIMARY KEY,
  code_hash TEXT UNIQUE,
  credential_hash TEXT NOT NULL,
  display_id UUID REFERENCES signage_displays(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ
);
CREATE INDEX signage_pairing_sessions_expiry ON signage_pairing_sessions(expires_at);
-- Replace the old administrator-generated codes. Existing connected players
-- keep their credentials and do not need to pair again.
UPDATE signage_displays SET pairing_hash=NULL,pairing_expires_at=NULL WHERE pairing_hash IS NOT NULL;
