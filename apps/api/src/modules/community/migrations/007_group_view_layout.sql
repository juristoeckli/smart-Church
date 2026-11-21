ALTER TABLE group_directory_views
  ADD COLUMN display_mode TEXT NOT NULL DEFAULT 'list' CHECK (display_mode IN ('list', 'table')),
  ADD COLUMN visible_columns TEXT[] NOT NULL DEFAULT ARRAY['type', 'status', 'members', 'start', 'end']
    CHECK (visible_columns <@ ARRAY['type', 'status', 'members', 'start', 'end']::TEXT[]);
