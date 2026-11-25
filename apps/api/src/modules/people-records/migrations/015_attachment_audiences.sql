ALTER TABLE people_record_attachments ADD COLUMN IF NOT EXISTS managers_only boolean NOT NULL DEFAULT false;
ALTER TABLE people_record_history ADD COLUMN IF NOT EXISTS managers_only boolean NOT NULL DEFAULT false;
