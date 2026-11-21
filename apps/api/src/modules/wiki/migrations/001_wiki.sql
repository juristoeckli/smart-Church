CREATE TABLE IF NOT EXISTS wiki_categories (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  parent_id UUID REFERENCES wiki_categories(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ,
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id, id)
);
CREATE INDEX IF NOT EXISTS wiki_categories_department_idx ON wiki_categories(department_id,position,lower(name));

CREATE TABLE IF NOT EXISTS wiki_pages (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  category_id UUID NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 180),
  content_html TEXT NOT NULL DEFAULT '' CHECK (length(content_html) <= 500000),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  redirect_url TEXT,
  is_homepage BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id, id),
  FOREIGN KEY (department_id, category_id) REFERENCES wiki_categories(department_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS wiki_pages_department_category_idx ON wiki_pages(department_id,category_id,status,lower(title));
CREATE INDEX IF NOT EXISTS wiki_pages_department_updated_idx ON wiki_pages(department_id,updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS wiki_pages_one_homepage_per_department_idx ON wiki_pages(department_id) WHERE is_homepage AND status='active';

CREATE TABLE IF NOT EXISTS wiki_page_versions (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  page_id UUID NOT NULL,
  title TEXT NOT NULL,
  content_html TEXT NOT NULL,
  editor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (department_id, page_id) REFERENCES wiki_pages(department_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS wiki_page_versions_page_idx ON wiki_page_versions(department_id,page_id,created_at DESC);

CREATE TABLE IF NOT EXISTS wiki_page_links (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  page_id UUID NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  url TEXT NOT NULL CHECK (length(url) BETWEEN 1 AND 2000),
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (department_id, page_id) REFERENCES wiki_pages(department_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS wiki_page_links_page_idx ON wiki_page_links(department_id,page_id,created_at);

CREATE UNIQUE INDEX IF NOT EXISTS stored_files_department_id_id_idx ON stored_files(department_id,id);
CREATE TABLE IF NOT EXISTS wiki_page_files (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  page_id UUID NOT NULL,
  file_id UUID NOT NULL,
  added_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id,page_id,file_id),
  FOREIGN KEY (department_id,page_id) REFERENCES wiki_pages(department_id,id) ON DELETE CASCADE,
  FOREIGN KEY (department_id,file_id) REFERENCES stored_files(department_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS wiki_page_files_page_idx ON wiki_page_files(department_id,page_id,created_at DESC);
