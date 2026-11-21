CREATE UNIQUE INDEX IF NOT EXISTS contacts_id_department_unique ON contacts(id,department_id);
CREATE TABLE IF NOT EXISTS people_record_fields (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 100),
  field_key TEXT NOT NULL CHECK (field_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  field_type TEXT NOT NULL CHECK (field_type IN ('text','date','boolean','select')),
  options JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options)='array'),
  required BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(department_id, field_key), UNIQUE(id, department_id)
);
CREATE TABLE IF NOT EXISTS people_record_values (
  department_id UUID NOT NULL,
  contact_id UUID NOT NULL,
  field_id UUID NOT NULL,
  value JSONB NOT NULL,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(department_id, contact_id, field_id),
  FOREIGN KEY(contact_id, department_id) REFERENCES contacts(id, department_id) ON DELETE CASCADE,
  FOREIGN KEY(field_id, department_id) REFERENCES people_record_fields(id, department_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS people_record_relationships (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  person_id UUID NOT NULL,
  related_person_id UUID NOT NULL,
  relationship TEXT NOT NULL CHECK(length(trim(relationship)) BETWEEN 1 AND 60),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(person_id <> related_person_id),
  FOREIGN KEY(person_id,department_id) REFERENCES contacts(id,department_id) ON DELETE CASCADE,
  FOREIGN KEY(related_person_id,department_id) REFERENCES contacts(id,department_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS people_record_relationships_people_idx ON people_record_relationships(department_id,person_id,related_person_id);
CREATE TABLE IF NOT EXISTS people_record_consents (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL,
  purpose TEXT NOT NULL CHECK(length(trim(purpose)) BETWEEN 1 AND 100),
  status TEXT NOT NULL CHECK(status IN ('granted','withdrawn','pending')),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at DATE,
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes)<=1000),
  actor_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(contact_id,department_id) REFERENCES contacts(id,department_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS people_record_consents_person_idx ON people_record_consents(department_id,contact_id,captured_at DESC);
CREATE TABLE IF NOT EXISTS people_record_history (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL,
  actor_user_id UUID,
  action TEXT NOT NULL,
  subject TEXT NOT NULL,
  before_value JSONB,
  after_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(contact_id,department_id) REFERENCES contacts(id,department_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS people_record_history_person_idx ON people_record_history(department_id,contact_id,created_at DESC);
CREATE TABLE IF NOT EXISTS people_record_import_audits (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  actor_user_id UUID,
  selected_count INTEGER NOT NULL,
  created_count INTEGER NOT NULL,
  skipped_count INTEGER NOT NULL,
  outcomes JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS people_record_person_dates (
  department_id UUID NOT NULL,
  contact_id UUID NOT NULL,
  date_kind TEXT NOT NULL CHECK(date_kind IN ('birth_date','wedding_anniversary')),
  date_value DATE NOT NULL,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(department_id,contact_id,date_kind),
  FOREIGN KEY(contact_id,department_id) REFERENCES contacts(id,department_id) ON DELETE CASCADE
);
