CREATE TABLE IF NOT EXISTS resource_booking_calendar_subscriptions (
  department_id uuid NOT NULL,
  user_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (department_id, user_id),
  FOREIGN KEY (user_id, department_id) REFERENCES department_memberships(user_id, department_id) ON DELETE CASCADE
);
