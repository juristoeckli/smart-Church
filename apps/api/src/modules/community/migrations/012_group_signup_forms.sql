CREATE TABLE group_signup_forms (
  group_id UUID PRIMARY KEY REFERENCES church_groups(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  revision UUID NOT NULL,
  questions JSONB NOT NULL CHECK (jsonb_typeof(questions)='array' AND jsonb_array_length(questions) BETWEEN 1 AND 8)
);

CREATE INDEX group_signup_forms_department_idx ON group_signup_forms(department_id);

ALTER TABLE group_join_requests ADD COLUMN answer_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(answer_snapshot)='array' AND jsonb_array_length(answer_snapshot)<=8);
