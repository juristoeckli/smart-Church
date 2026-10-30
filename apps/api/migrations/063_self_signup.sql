CREATE TABLE installation_self_signup_settings (
  installation_id UUID PRIMARY KEY REFERENCES installations(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  confirmation_delay_minutes INTEGER NOT NULL DEFAULT 11 CHECK (confirmation_delay_minutes BETWEEN 1 AND 1440),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE self_signup_requests (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  street TEXT NOT NULL DEFAULT '',
  street_number TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'awaiting_profile' CHECK (status IN ('awaiting_profile','awaiting_confirmation','pending_admin','approved_delivery_failed','approved','denied','expired')),
  initial_token_hash TEXT,
  initial_expires_at TIMESTAMPTZ,
  initial_requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmation_token_hash TEXT,
  confirmation_origin TEXT,
  confirmation_available_at TIMESTAMPTZ,
  confirmation_expires_at TIMESTAMPTZ,
  confirmation_sent_at TIMESTAMPTZ,
  confirmation_attempts INTEGER NOT NULL DEFAULT 0,
  next_confirmation_attempt_at TIMESTAMPTZ,
  email_confirmed_at TIMESTAMPTZ,
  account_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE INDEX self_signup_confirmation_due_idx ON self_signup_requests (next_confirmation_attempt_at, confirmation_available_at)
  WHERE status = 'awaiting_confirmation' AND confirmation_sent_at IS NULL;
CREATE INDEX self_signup_admin_review_idx ON self_signup_requests (created_at)
  WHERE status IN ('pending_admin','approved_delivery_failed');
