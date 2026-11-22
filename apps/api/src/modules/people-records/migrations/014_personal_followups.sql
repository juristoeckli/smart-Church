CREATE TABLE IF NOT EXISTS people_personal_followups (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  details TEXT NOT NULL DEFAULT '' CHECK (length(details) <= 4000),
  due_on DATE NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  completed_at TIMESTAMPTZ,
  FOREIGN KEY (contact_id, department_id) REFERENCES contacts(id, department_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS people_personal_followups_owner_profile_due
  ON people_personal_followups(department_id,owner_user_id,contact_id,due_on,id);
