ALTER TABLE group_directory_views
  ADD COLUMN sort_order TEXT NOT NULL DEFAULT 'name_asc'
    CHECK (sort_order IN ('name_asc', 'name_desc', 'members_desc', 'start_desc'));
