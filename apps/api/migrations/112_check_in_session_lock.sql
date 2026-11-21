CREATE TABLE IF NOT EXISTS check_in_sessions (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES service_events(id) ON DELETE CASCADE,
  completed_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(department_id,event_id)
);
