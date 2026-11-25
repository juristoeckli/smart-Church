ALTER TABLE people_record_relationship_types
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private_people'
    CHECK (visibility IN ('private_people','people_managers'));
