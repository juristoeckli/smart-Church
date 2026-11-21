ALTER TABLE overview_location_welcome ADD COLUMN IF NOT EXISTS notice TEXT NOT NULL DEFAULT '' CHECK (char_length(notice) <= 300);
