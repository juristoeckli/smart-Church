ALTER TABLE wiki_pages
  ADD COLUMN IF NOT EXISTS redirect_page_id UUID;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='wiki_pages_redirect_page_fk') THEN
    ALTER TABLE wiki_pages ADD CONSTRAINT wiki_pages_redirect_page_fk
      FOREIGN KEY (department_id,redirect_page_id)
      REFERENCES wiki_pages(department_id,id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS wiki_pages_redirect_page_idx
  ON wiki_pages(department_id,redirect_page_id) WHERE redirect_page_id IS NOT NULL;
