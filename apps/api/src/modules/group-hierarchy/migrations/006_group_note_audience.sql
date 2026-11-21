ALTER TABLE group_notes ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'group_leaders'
  CHECK (audience IN ('group_leaders','group_managers'));
