ALTER TABLE group_signup_forms
  ADD COLUMN connected_admission BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT group_signup_forms_connected_role_check CHECK (NOT connected_admission OR lower(trim(default_role))='member');
