CREATE TABLE IF NOT EXISTS sync_installation_identity (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  installation_id UUID NOT NULL UNIQUE REFERENCES installations(id) ON DELETE RESTRICT,
  public_key_pem TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_peers (
  installation_id UUID PRIMARY KEY,
  display_name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  public_key_pem TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  trust_state TEXT NOT NULL CHECK (trust_state IN ('pending', 'trusted', 'revoked')),
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  requested_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS sync_pairing_invitations (
  id UUID PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ,
  used_by UUID
);

CREATE INDEX IF NOT EXISTS sync_pairing_invitations_expiry_idx
  ON sync_pairing_invitations(expires_at) WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS sync_request_nonces (
  installation_id UUID NOT NULL,
  nonce TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (installation_id, nonce)
);

CREATE INDEX IF NOT EXISTS sync_request_nonces_expiry_idx ON sync_request_nonces(expires_at);

CREATE TABLE IF NOT EXISTS sync_peer_audit (
  id UUID PRIMARY KEY,
  peer_installation_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('pair_requested', 'trusted', 'revoked')),
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
