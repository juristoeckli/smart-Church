CREATE TABLE IF NOT EXISTS people_record_relationship_types (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK(length(trim(label)) BETWEEN 1 AND 60),
  reverse_label TEXT NOT NULL CHECK(length(trim(reverse_label)) BETWEEN 1 AND 60),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(department_id,id)
);

CREATE UNIQUE INDEX IF NOT EXISTS people_record_relationship_types_label_uq
  ON people_record_relationship_types(department_id,lower(trim(label)));

ALTER TABLE people_record_relationships
  ADD COLUMN IF NOT EXISTS relationship_type_id UUID;

DO $relationship_type_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='people_record_relationships_type_fk'
      AND conrelid='people_record_relationships'::regclass
  ) THEN
    ALTER TABLE people_record_relationships
      ADD CONSTRAINT people_record_relationships_type_fk
      FOREIGN KEY(department_id,relationship_type_id)
      REFERENCES people_record_relationship_types(department_id,id) ON DELETE RESTRICT;
  END IF;
END
$relationship_type_fk$;

CREATE INDEX IF NOT EXISTS people_record_relationships_type_idx
  ON people_record_relationships(department_id,relationship_type_id)
  WHERE relationship_type_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS people_record_relationships_typed_pair_uq
  ON people_record_relationships(
    department_id,
    relationship_type_id,
    LEAST(person_id,related_person_id),
    GREATEST(person_id,related_person_id)
  ) WHERE relationship_type_id IS NOT NULL;
