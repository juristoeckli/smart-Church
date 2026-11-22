CREATE TABLE IF NOT EXISTS church_calendar_tag_definitions (
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  tag_key text NOT NULL CHECK (char_length(tag_key) BETWEEN 1 AND 40),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 40),
  color text CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  description text NOT NULL DEFAULT '' CHECK (char_length(description)<=500),
  PRIMARY KEY (department_id,tag_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS church_calendar_tag_definition_names_idx
  ON church_calendar_tag_definitions(department_id,lower(name));
