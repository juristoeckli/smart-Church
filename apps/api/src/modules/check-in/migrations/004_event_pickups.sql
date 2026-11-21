CREATE TABLE IF NOT EXISTS check_in_event_pickups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES service_events(id) ON DELETE CASCADE,
  child_contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  authorized_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  guardian_confirmed_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  guardian_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  released_at TIMESTAMPTZ,
  identity_check TEXT CHECK (identity_check IN ('photo_id','personally_known')),
  UNIQUE (department_id,event_id,child_contact_id,authorized_contact_id),
  CHECK (child_contact_id <> authorized_contact_id),
  CHECK ((released_at IS NULL) = (identity_check IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS check_in_event_pickups_once_idx
  ON check_in_event_pickups (department_id,event_id,child_contact_id)
  WHERE released_at IS NOT NULL;
