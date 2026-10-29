ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en'
    CHECK (language IN ('en', 'de', 'fr', 'it'));
