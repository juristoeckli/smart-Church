ALTER TABLE group_directory_views
  ADD COLUMN IF NOT EXISTS source_filter TEXT NOT NULL DEFAULT 'all'
  CHECK (source_filter IN ('all', 'local', 'churchtools', 'elvanto'));
