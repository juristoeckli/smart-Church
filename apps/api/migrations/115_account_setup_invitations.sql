CREATE TABLE account_setup_invitations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  issued_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  revoked_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  token_digest TEXT NOT NULL UNIQUE,
  credential_digest TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX one_pending_account_setup_invitation
  ON account_setup_invitations(user_id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
