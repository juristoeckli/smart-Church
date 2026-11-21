CREATE TABLE IF NOT EXISTS event_person_absences (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('holiday','illness','family','work','other')),
  private_note VARCHAR(1000) NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ,
  UNIQUE(department_id,id),
  CHECK (ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS event_person_absences_contact_date_idx
  ON event_person_absences(department_id,contact_id,starts_on,ends_on) WHERE status='active';

CREATE TABLE IF NOT EXISTS event_person_absence_audit (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  absence_id UUID NOT NULL,
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('created','cancelled')),
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(department_id,absence_id) REFERENCES event_person_absences(department_id,id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS event_person_absence_audit_idx
  ON event_person_absence_audit(department_id,absence_id,created_at DESC);
