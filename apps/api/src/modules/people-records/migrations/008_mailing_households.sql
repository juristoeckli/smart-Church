CREATE TABLE IF NOT EXISTS people_record_households (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  salutation TEXT NOT NULL DEFAULT '' CHECK (length(salutation) <= 160),
  postal_address JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(postal_address) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(id,department_id)
);

CREATE TABLE IF NOT EXISTS people_record_household_members (
  department_id UUID NOT NULL,
  contact_id UUID NOT NULL,
  household_id UUID NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(department_id,contact_id),
  FOREIGN KEY(contact_id,department_id) REFERENCES contacts(id,department_id) ON DELETE CASCADE,
  FOREIGN KEY(household_id,department_id) REFERENCES people_record_households(id,department_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS people_record_household_members_household_idx
  ON people_record_household_members(department_id,household_id,contact_id);

CREATE OR REPLACE FUNCTION smart_church_remove_empty_people_household() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM people_record_households WHERE id=OLD.household_id AND department_id=OLD.department_id FOR UPDATE;
  IF FOUND THEN
    DELETE FROM people_record_households household WHERE household.id=OLD.household_id AND household.department_id=OLD.department_id
      AND NOT EXISTS (SELECT 1 FROM people_record_household_members member WHERE member.department_id=household.department_id AND member.household_id=household.id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS people_record_remove_empty_household ON people_record_household_members;
CREATE TRIGGER people_record_remove_empty_household AFTER DELETE ON people_record_household_members
  FOR EACH ROW EXECUTE FUNCTION smart_church_remove_empty_people_household();
