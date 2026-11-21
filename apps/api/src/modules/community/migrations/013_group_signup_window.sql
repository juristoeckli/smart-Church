ALTER TABLE group_signup_forms DROP CONSTRAINT group_signup_forms_questions_check;
ALTER TABLE group_signup_forms
  ADD CONSTRAINT group_signup_forms_questions_check CHECK (jsonb_typeof(questions)='array' AND jsonb_array_length(questions)<=8),
  ADD COLUMN opens_at TIMESTAMPTZ,
  ADD COLUMN closes_at TIMESTAMPTZ,
  ADD COLUMN default_role TEXT NOT NULL DEFAULT 'Member' CHECK (length(trim(default_role)) BETWEEN 1 AND 80),
  ADD COLUMN heading TEXT NOT NULL DEFAULT '' CHECK (length(heading)<=120),
  ADD CONSTRAINT group_signup_forms_window_check CHECK (opens_at IS NULL OR closes_at IS NULL OR opens_at<closes_at);
