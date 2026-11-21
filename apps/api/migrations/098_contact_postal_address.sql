ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS postal_address JSONB NOT NULL DEFAULT '{}'::jsonb;
