ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS elvanto_profile JSONB NOT NULL DEFAULT '{}'::jsonb;
