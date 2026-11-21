CREATE TABLE IF NOT EXISTS event_position_swap_requests (
  id UUID PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES service_events(id) ON DELETE CASCADE,
  from_position_index INTEGER NOT NULL CHECK (from_position_index >= 0),
  to_position_index INTEGER NOT NULL CHECK (to_position_index >= 0),
  requester_contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  target_contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  CHECK (from_position_index <> to_position_index)
);

CREATE UNIQUE INDEX IF NOT EXISTS event_position_swap_pending_pair_idx
  ON event_position_swap_requests(event_id, from_position_index, to_position_index)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS event_position_swap_inbox_idx
  ON event_position_swap_requests(target_contact_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS event_position_swap_outbox_idx
  ON event_position_swap_requests(requester_contact_id, status, created_at DESC);
