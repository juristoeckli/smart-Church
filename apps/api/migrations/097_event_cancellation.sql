ALTER TABLE service_events
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

CREATE INDEX IF NOT EXISTS service_events_cancelled_schedule_idx
  ON service_events(department_id,event_date,cancelled_at);

CREATE TABLE IF NOT EXISTS service_event_lifecycle_audit (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES service_events(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('cancelled','restored')),
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_event_lifecycle_audit_event_idx
  ON service_event_lifecycle_audit(event_id,created_at);
