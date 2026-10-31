ALTER TABLE signage_shows ADD COLUMN IF NOT EXISTS published_title TEXT;
ALTER TABLE signage_shows ADD COLUMN IF NOT EXISTS published_slides JSONB;
ALTER TABLE signage_shows ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE signage_shows ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE signage_displays ADD COLUMN IF NOT EXISTS default_show_id UUID;
ALTER TABLE signage_displays ADD COLUMN IF NOT EXISTS pairing_hash TEXT;
ALTER TABLE signage_displays ADD COLUMN IF NOT EXISTS pairing_expires_at TIMESTAMPTZ;
ALTER TABLE signage_displays ADD COLUMN IF NOT EXISTS player_version TEXT;
ALTER TABLE signage_displays ADD COLUMN IF NOT EXISTS playback_error TEXT;
ALTER TABLE signage_displays ADD COLUMN IF NOT EXISTS current_show_id TEXT;
ALTER TABLE signage_displays ADD COLUMN IF NOT EXISTS download_progress INTEGER;
ALTER TABLE signage_displays ADD CONSTRAINT signage_default_show_fkey FOREIGN KEY(department_id,default_show_id) REFERENCES signage_shows(department_id,id);
CREATE TABLE signage_media (
 id UUID PRIMARY KEY, department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
 name TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, data BYTEA NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX signage_media_site_idx ON signage_media(department_id);
ALTER TABLE signage_displays ADD COLUMN IF NOT EXISTS managed_account BOOLEAN NOT NULL DEFAULT false;
