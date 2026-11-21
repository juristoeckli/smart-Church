ALTER TABLE church_groups
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS starts_on DATE,
  ADD COLUMN IF NOT EXISTS ends_on DATE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='church_groups_status_check') THEN
    ALTER TABLE church_groups ADD CONSTRAINT church_groups_status_check CHECK (status IN ('active','draft','ended','archived'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='church_groups_date_range_check') THEN
    ALTER TABLE church_groups ADD CONSTRAINT church_groups_date_range_check CHECK (starts_on IS NULL OR ends_on IS NULL OR starts_on <= ends_on);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS church_groups_lifecycle_idx
  ON church_groups(department_id,status,lower(name));

ALTER TABLE group_directory_views
  ADD COLUMN IF NOT EXISTS status_filter TEXT NOT NULL DEFAULT 'all';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='group_directory_views_status_filter_check') THEN
    ALTER TABLE group_directory_views ADD CONSTRAINT group_directory_views_status_filter_check CHECK (status_filter IN ('all','active','draft','ended','archived'));
  END IF;
END $$;
