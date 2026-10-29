ALTER TABLE self_signup_requests
  DROP CONSTRAINT IF EXISTS self_signup_requests_status_check;

ALTER TABLE self_signup_requests
  ADD CONSTRAINT self_signup_requests_status_check
  CHECK (status IN ('awaiting_profile','awaiting_confirmation','pending_admin','pending_expiry_notification','approved_delivery_failed','approved','denied','expired'));

ALTER TABLE self_signup_requests
  ADD COLUMN expiry_notification_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN next_expiry_notification_at TIMESTAMPTZ;

CREATE INDEX self_signup_expiry_notification_idx ON self_signup_requests (next_expiry_notification_at, email_confirmed_at)
  WHERE status = 'pending_expiry_notification';
