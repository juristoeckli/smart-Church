CREATE TABLE IF NOT EXISTS people_record_attachments (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  contact_id UUID NOT NULL,
  file_name TEXT NOT NULL CHECK (length(file_name) BETWEEN 1 AND 180),
  file_size INTEGER NOT NULL CHECK (file_size BETWEEN 1 AND 10485760),
  file_data BYTEA NOT NULL CHECK (octet_length(file_data) = file_size),
  uploaded_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (contact_id,department_id) REFERENCES contacts(id,department_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS people_record_attachments_contact_idx
  ON people_record_attachments(department_id,contact_id,created_at DESC,id);
