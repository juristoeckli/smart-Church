ALTER TABLE event_registrations
  ADD COLUMN IF NOT EXISTS cancellation_token_hash TEXT
  CHECK (cancellation_token_hash ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_cancellation_token_idx
  ON event_registrations(cancellation_token_hash) WHERE cancellation_token_hash IS NOT NULL;
