CREATE TABLE IF NOT EXISTS churchtools_migration_arrangement_media (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  instance_url TEXT NOT NULL,
  source_song_id TEXT NOT NULL,
  source_arrangement_id TEXT NOT NULL,
  source_file_id TEXT NOT NULL,
  arrangement_id UUID NOT NULL REFERENCES worship_song_arrangements(id) ON DELETE CASCADE,
  slot TEXT NOT NULL CHECK (slot IN ('chart','audio')),
  approved_url TEXT NOT NULL,
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id,instance_url,source_song_id,source_arrangement_id,source_file_id),
  UNIQUE (arrangement_id,slot)
);
