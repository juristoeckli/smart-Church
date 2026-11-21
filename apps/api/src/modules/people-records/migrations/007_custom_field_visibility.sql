ALTER TABLE people_record_fields
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private_people'
  CHECK (visibility IN ('private_people', 'people_managers'));
