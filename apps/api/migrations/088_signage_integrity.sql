ALTER TABLE signage_media ADD CONSTRAINT signage_media_size_check
  CHECK (size = octet_length(data) AND size > 0 AND size <= 104857600);
ALTER TABLE signage_media ADD COLUMN sha256 TEXT GENERATED ALWAYS AS (encode(sha256(data), 'hex')) STORED;
ALTER TABLE signage_media ADD CONSTRAINT signage_media_site_id_key UNIQUE (department_id,id);

-- Real foreign keys protect both published and draft references, including
-- concurrent uploads, edits, publishing, and media deletion.
CREATE TABLE signage_show_media (
  department_id UUID NOT NULL,
  show_id UUID NOT NULL,
  media_id UUID NOT NULL,
  PRIMARY KEY(show_id,media_id),
  FOREIGN KEY(department_id,show_id) REFERENCES signage_shows(department_id,id) ON DELETE CASCADE,
  FOREIGN KEY(department_id,media_id) REFERENCES signage_media(department_id,id) ON DELETE RESTRICT
);
CREATE FUNCTION signage_sync_media_references() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM signage_show_media WHERE show_id=NEW.id;
  INSERT INTO signage_show_media(department_id,show_id,media_id)
    SELECT NEW.department_id,NEW.id,(slide->>'mediaId')::uuid
    FROM jsonb_array_elements(NEW.slides || COALESCE(NEW.published_slides,'[]'::jsonb)) AS slide
    WHERE slide->>'mediaId' IS NOT NULL
    GROUP BY slide->>'mediaId';
  RETURN NEW;
END $$;
CREATE TRIGGER signage_media_references AFTER INSERT OR UPDATE OF slides,published_slides
  ON signage_shows FOR EACH ROW EXECUTE FUNCTION signage_sync_media_references();
INSERT INTO signage_show_media(department_id,show_id,media_id)
  SELECT s.department_id,s.id,(slide->>'mediaId')::uuid
  FROM signage_shows s CROSS JOIN LATERAL jsonb_array_elements(s.slides || COALESCE(s.published_slides,'[]'::jsonb)) AS slide
  WHERE slide->>'mediaId' IS NOT NULL
  GROUP BY s.department_id,s.id,slide->>'mediaId';

CREATE UNIQUE INDEX signage_pairing_code_unique ON signage_displays(pairing_hash) WHERE pairing_hash IS NOT NULL;
CREATE TABLE signage_pairing_attempts (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  resets_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX signage_pairing_attempts_expiry ON signage_pairing_attempts(resets_at);
ALTER TABLE signage_shows ADD COLUMN draft_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE signage_shows ADD COLUMN published_draft_version INTEGER;
UPDATE signage_shows SET published_draft_version=1 WHERE published_at IS NOT NULL AND slides=published_slides AND title=published_title;
