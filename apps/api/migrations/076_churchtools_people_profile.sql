ALTER TABLE contacts
  ADD COLUMN churchtools_profile JSONB NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(churchtools_profile) = 'object');
