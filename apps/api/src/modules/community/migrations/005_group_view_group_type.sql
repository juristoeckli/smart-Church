ALTER TABLE group_directory_views
  ADD COLUMN IF NOT EXISTS group_type_filter TEXT NOT NULL DEFAULT '';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='group_directory_views_group_type_filter_length_check') THEN
    ALTER TABLE group_directory_views
      ADD CONSTRAINT group_directory_views_group_type_filter_length_check
      CHECK (length(group_type_filter) <= 80);
  END IF;
END $$;
