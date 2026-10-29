ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS language_is_custom BOOLEAN NOT NULL DEFAULT false;

-- Preserve non-English preferences that existed before the custom/default distinction.
UPDATE app_users
   SET language_is_custom = true
 WHERE language <> 'en';
