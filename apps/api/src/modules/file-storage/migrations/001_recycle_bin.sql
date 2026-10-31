ALTER TABLE stored_files
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS stored_files_recycle_bin_idx
  ON stored_files (department_id, deleted_at DESC)
  WHERE deleted_at IS NOT NULL;
