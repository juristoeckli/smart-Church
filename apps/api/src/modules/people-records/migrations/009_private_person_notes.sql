CREATE TABLE IF NOT EXISTS people_record_private_notes (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  contact_id UUID NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  edited_at TIMESTAMPTZ,
  edited_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  archived_at TIMESTAMPTZ,
  archived_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  FOREIGN KEY (contact_id,department_id) REFERENCES contacts(id,department_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS people_record_private_notes_contact_idx
  ON people_record_private_notes(department_id,contact_id,(archived_at IS NOT NULL),created_at DESC,id DESC);
