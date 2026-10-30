ALTER TABLE self_signup_requests
  ADD COLUMN language TEXT NOT NULL DEFAULT 'en'
  CHECK (language IN ('en','de','fr','it'));
