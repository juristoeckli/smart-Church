CREATE TABLE check_in_label_templates (
  department_id UUID PRIMARY KEY REFERENCES departments(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  individual VARCHAR(480) NOT NULL DEFAULT '',
  child VARCHAR(480) NOT NULL DEFAULT '',
  parent VARCHAR(480) NOT NULL DEFAULT ''
);
