CREATE UNIQUE INDEX IF NOT EXISTS stored_files_department_id_id_idx ON stored_files(department_id,id);

CREATE TABLE IF NOT EXISTS stored_file_versions (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  file_id UUID NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 26214400),
  file_data BYTEA NOT NULL,
  uploaded_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (department_id,file_id) REFERENCES stored_files(department_id,id) ON DELETE CASCADE,
  UNIQUE (department_id,file_id,version_number)
);

CREATE INDEX IF NOT EXISTS stored_file_versions_history_idx
  ON stored_file_versions(department_id,file_id,version_number DESC);
