CREATE TABLE IF NOT EXISTS event_position_staff_notes (
  event_id UUID NOT NULL REFERENCES service_events(id) ON DELETE CASCADE,
  position_index INTEGER NOT NULL CHECK (position_index >= 0),
  position_name TEXT NOT NULL CHECK (length(trim(position_name)) BETWEEN 1 AND 80),
  note TEXT NOT NULL CHECK (length(note) BETWEEN 1 AND 500),
  updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, position_index)
);

CREATE TABLE IF NOT EXISTS event_position_staff_note_audit (
  id UUID PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES service_events(id) ON DELETE CASCADE,
  position_index INTEGER NOT NULL CHECK (position_index >= 0),
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  note_length INTEGER NOT NULL DEFAULT 0 CHECK (note_length BETWEEN 0 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_position_staff_note_audit_event_idx
  ON event_position_staff_note_audit(event_id, position_index, created_at DESC);
