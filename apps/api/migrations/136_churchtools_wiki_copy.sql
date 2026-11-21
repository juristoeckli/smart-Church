CREATE TABLE IF NOT EXISTS churchtools_migration_wiki_categories (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  instance_url TEXT NOT NULL,
  source_category_id TEXT NOT NULL CHECK (source_category_id ~ '^[1-9][0-9]{0,15}$'),
  category_id UUID NOT NULL UNIQUE,
  PRIMARY KEY (department_id,instance_url,source_category_id)
);

CREATE TABLE IF NOT EXISTS churchtools_migration_wiki_pages (
  department_id UUID NOT NULL,
  instance_url TEXT NOT NULL,
  source_category_id TEXT NOT NULL,
  source_guid UUID NOT NULL,
  source_version BIGINT NOT NULL CHECK (source_version>0),
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  page_id UUID NOT NULL UNIQUE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id,instance_url,source_guid),
  FOREIGN KEY (department_id,instance_url,source_category_id)
    REFERENCES churchtools_migration_wiki_categories(department_id,instance_url,source_category_id) ON DELETE CASCADE
);
