CREATE TABLE IF NOT EXISTS church_calendar_subscriptions (
  calendar_id UUID NOT NULL,
  department_id UUID NOT NULL,
  user_id UUID NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (calendar_id, user_id),
  FOREIGN KEY (calendar_id, department_id) REFERENCES church_calendar_calendars(id, department_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, department_id) REFERENCES department_memberships(user_id, department_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS church_calendar_subscriptions_user_location_idx
  ON church_calendar_subscriptions(user_id, department_id);
