ALTER TABLE sync_peers
  ADD COLUMN IF NOT EXISTS outbound_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS inbound_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE sync_pairing_invitations
  ADD COLUMN IF NOT EXISTS connection_mode TEXT NOT NULL DEFAULT 'both'
    CHECK (connection_mode IN ('both', 'creator_to_joiner', 'joiner_to_creator'));
