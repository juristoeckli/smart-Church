CREATE TABLE IF NOT EXISTS event_position_responses (
  event_id UUID NOT NULL REFERENCES service_events(id) ON DELETE CASCADE,
  position_index INTEGER NOT NULL CHECK (position_index >= 0),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  responded_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, position_index),
  UNIQUE (event_id, position_index, contact_id)
);

CREATE INDEX IF NOT EXISTS event_position_responses_contact_idx ON event_position_responses (contact_id, status, event_id);
