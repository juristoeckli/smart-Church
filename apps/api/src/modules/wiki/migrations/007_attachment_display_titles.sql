ALTER TABLE wiki_page_files
  ADD COLUMN IF NOT EXISTS display_title TEXT
  CHECK (display_title IS NULL OR length(trim(display_title)) BETWEEN 1 AND 160);
