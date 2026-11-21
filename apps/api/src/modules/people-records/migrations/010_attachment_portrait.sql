ALTER TABLE people_record_attachments ADD COLUMN IF NOT EXISTS is_portrait boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS people_record_attachments_one_portrait
  ON people_record_attachments(department_id,contact_id) WHERE is_portrait;
