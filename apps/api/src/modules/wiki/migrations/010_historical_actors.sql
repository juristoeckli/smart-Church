ALTER TABLE wiki_categories
  ADD COLUMN IF NOT EXISTS created_actor_id UUID,
  ADD COLUMN IF NOT EXISTS created_actor_name TEXT;

UPDATE wiki_categories record
SET created_actor_id=actor.id, created_actor_name=actor.display_name
FROM app_users actor
WHERE record.created_by=actor.id AND record.created_actor_id IS NULL;

ALTER TABLE wiki_categories
  ADD COLUMN IF NOT EXISTS updated_actor_id UUID,
  ADD COLUMN IF NOT EXISTS updated_actor_name TEXT;

UPDATE wiki_categories record
SET updated_actor_id=actor.id, updated_actor_name=actor.display_name
FROM app_users actor
WHERE record.updated_by=actor.id AND record.updated_actor_id IS NULL;

ALTER TABLE wiki_pages
  ADD COLUMN IF NOT EXISTS created_actor_id UUID,
  ADD COLUMN IF NOT EXISTS created_actor_name TEXT;

UPDATE wiki_pages record
SET created_actor_id=actor.id, created_actor_name=actor.display_name
FROM app_users actor
WHERE record.created_by=actor.id AND record.created_actor_id IS NULL;

ALTER TABLE wiki_pages
  ADD COLUMN IF NOT EXISTS updated_actor_id UUID,
  ADD COLUMN IF NOT EXISTS updated_actor_name TEXT;

UPDATE wiki_pages record
SET updated_actor_id=actor.id, updated_actor_name=actor.display_name
FROM app_users actor
WHERE record.updated_by=actor.id AND record.updated_actor_id IS NULL;

ALTER TABLE wiki_page_versions
  ADD COLUMN IF NOT EXISTS editor_actor_id UUID,
  ADD COLUMN IF NOT EXISTS editor_actor_name TEXT;

UPDATE wiki_page_versions record
SET editor_actor_id=actor.id, editor_actor_name=actor.display_name
FROM app_users actor
WHERE record.editor_user_id=actor.id AND record.editor_actor_id IS NULL;

ALTER TABLE wiki_page_links
  ADD COLUMN IF NOT EXISTS creator_actor_id UUID,
  ADD COLUMN IF NOT EXISTS creator_actor_name TEXT;

UPDATE wiki_page_links record
SET creator_actor_id=actor.id, creator_actor_name=actor.display_name
FROM app_users actor
WHERE record.created_by=actor.id AND record.creator_actor_id IS NULL;

ALTER TABLE wiki_page_files
  ADD COLUMN IF NOT EXISTS uploader_actor_id UUID,
  ADD COLUMN IF NOT EXISTS uploader_actor_name TEXT;

UPDATE wiki_page_files record
SET uploader_actor_id=actor.id, uploader_actor_name=actor.display_name
FROM app_users actor
WHERE record.added_by=actor.id AND record.uploader_actor_id IS NULL;

-- Historical actor IDs deliberately have no account foreign key.
CREATE OR REPLACE FUNCTION wiki_capture_record_actors() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.created_actor_id IS NULL AND NEW.created_by IS NOT NULL THEN
    NEW.created_actor_id := NEW.created_by;
    SELECT display_name INTO NEW.created_actor_name FROM app_users WHERE id=NEW.created_by;
  END IF;

  IF NEW.updated_by IS NOT NULL AND (
    (TG_OP = 'INSERT' AND NEW.updated_actor_id IS NULL)
    OR (TG_OP = 'UPDATE' AND (NEW.updated_by IS DISTINCT FROM OLD.updated_by OR NEW.updated_at IS DISTINCT FROM OLD.updated_at))
  ) THEN
    NEW.updated_actor_id := NEW.updated_by;
    SELECT display_name INTO NEW.updated_actor_name FROM app_users WHERE id=NEW.updated_by;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wiki_category_record_actors ON wiki_categories;
CREATE TRIGGER wiki_category_record_actors
  BEFORE INSERT OR UPDATE OF created_by, updated_by, updated_at ON wiki_categories
  FOR EACH ROW EXECUTE FUNCTION wiki_capture_record_actors();

DROP TRIGGER IF EXISTS wiki_page_record_actors ON wiki_pages;
CREATE TRIGGER wiki_page_record_actors
  BEFORE INSERT OR UPDATE OF created_by, updated_by, updated_at ON wiki_pages
  FOR EACH ROW EXECUTE FUNCTION wiki_capture_record_actors();

CREATE OR REPLACE FUNCTION wiki_capture_history_actor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'wiki_page_versions' THEN
    IF NEW.editor_actor_id IS NULL AND NEW.editor_user_id IS NOT NULL THEN
      NEW.editor_actor_id := NEW.editor_user_id;
      SELECT display_name INTO NEW.editor_actor_name FROM app_users WHERE id=NEW.editor_user_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'wiki_page_links' THEN
    IF NEW.creator_actor_id IS NULL AND NEW.created_by IS NOT NULL THEN
      NEW.creator_actor_id := NEW.created_by;
      SELECT display_name INTO NEW.creator_actor_name FROM app_users WHERE id=NEW.created_by;
    END IF;
  ELSIF TG_TABLE_NAME = 'wiki_page_files' THEN
    IF NEW.uploader_actor_id IS NULL AND NEW.added_by IS NOT NULL THEN
      NEW.uploader_actor_id := NEW.added_by;
      SELECT display_name INTO NEW.uploader_actor_name FROM app_users WHERE id=NEW.added_by;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wiki_version_history_actor ON wiki_page_versions;
CREATE TRIGGER wiki_version_history_actor BEFORE INSERT ON wiki_page_versions
  FOR EACH ROW EXECUTE FUNCTION wiki_capture_history_actor();

DROP TRIGGER IF EXISTS wiki_link_history_actor ON wiki_page_links;
CREATE TRIGGER wiki_link_history_actor BEFORE INSERT ON wiki_page_links
  FOR EACH ROW EXECUTE FUNCTION wiki_capture_history_actor();

DROP TRIGGER IF EXISTS wiki_file_history_actor ON wiki_page_files;
CREATE TRIGGER wiki_file_history_actor BEFORE INSERT ON wiki_page_files
  FOR EACH ROW EXECUTE FUNCTION wiki_capture_history_actor();
