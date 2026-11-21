ALTER TABLE wiki_pages
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'location'
    CHECK (audience IN ('location','group','managers')),
  ADD COLUMN IF NOT EXISTS audience_group_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS church_groups_department_id_id_idx
  ON church_groups(department_id,id);

ALTER TABLE wiki_pages
  ADD CONSTRAINT wiki_pages_audience_group_fk
  FOREIGN KEY (department_id,audience_group_id)
  REFERENCES church_groups(department_id,id) ON DELETE RESTRICT;

ALTER TABLE wiki_pages
  ADD CONSTRAINT wiki_pages_audience_group_check
  CHECK ((audience='group' AND audience_group_id IS NOT NULL) OR (audience<>'group' AND audience_group_id IS NULL));

CREATE INDEX IF NOT EXISTS wiki_pages_audience_idx
  ON wiki_pages(department_id,audience,audience_group_id,status);
