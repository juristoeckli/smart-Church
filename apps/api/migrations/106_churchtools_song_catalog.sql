ALTER TABLE churchtools_migration_links
  DROP CONSTRAINT IF EXISTS churchtools_migration_links_area_check;

ALTER TABLE churchtools_migration_links
  ADD CONSTRAINT churchtools_migration_links_area_check
    CHECK (area IN ('person', 'group', 'event', 'resource', 'song', 'song_arrangement'));
