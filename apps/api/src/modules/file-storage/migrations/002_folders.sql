CREATE TABLE IF NOT EXISTS stored_file_folders (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  parent_id UUID REFERENCES stored_file_folders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stored_file_folders_department_parent_idx
  ON stored_file_folders (department_id, parent_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS stored_file_folders_sibling_name_idx
  ON stored_file_folders (department_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

ALTER TABLE stored_files ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES stored_file_folders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS stored_files_department_folder_idx ON stored_files (department_id, folder_id) WHERE deleted_at IS NULL;
