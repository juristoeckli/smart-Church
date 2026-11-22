ALTER TABLE people_growth_config
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'people_managers'
    CHECK (visibility IN ('people_managers','private_people'));
