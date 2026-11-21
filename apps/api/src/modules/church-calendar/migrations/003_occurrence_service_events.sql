CREATE TABLE IF NOT EXISTS church_calendar_event_generations (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL,
  occurrence_start TIMESTAMP NOT NULL,
  service_event_id UUID,
  template_id UUID NOT NULL,
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS church_calendar_event_generations_appointment_idx
  ON church_calendar_event_generations(department_id,appointment_id,occurrence_start DESC);
