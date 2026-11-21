CREATE TABLE IF NOT EXISTS group_member_field_definitions (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES church_groups(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  field_type TEXT NOT NULL CHECK (field_type IN ('text','number','boolean','date','select')),
  options JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS group_member_field_definitions_label_idx
  ON group_member_field_definitions(department_id,group_id,lower(label));

CREATE TABLE IF NOT EXISTS group_member_field_answers (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES church_groups(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL,
  field_values JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(field_values) = 'object'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  PRIMARY KEY(department_id,group_id,contact_id),
  FOREIGN KEY(contact_id,department_id) REFERENCES contacts(id,department_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS group_member_field_answers_contact_idx
  ON group_member_field_answers(contact_id,department_id);
