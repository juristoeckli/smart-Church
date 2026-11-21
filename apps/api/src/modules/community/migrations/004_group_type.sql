ALTER TABLE church_groups
  ADD COLUMN IF NOT EXISTS group_type TEXT NOT NULL DEFAULT '';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='church_groups_group_type_length_check') THEN
    ALTER TABLE church_groups ADD CONSTRAINT church_groups_group_type_length_check CHECK (length(group_type) <= 80);
  END IF;
END $$;
