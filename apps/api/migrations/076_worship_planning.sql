CREATE TABLE IF NOT EXISTS worship_songs (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  authors TEXT NOT NULL DEFAULT '' CHECK (length(authors) <= 500),
  default_key TEXT NOT NULL DEFAULT '' CHECK (length(default_key) <= 16),
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS worship_songs_department_title_idx
  ON worship_songs (department_id, lower(title));

CREATE TABLE IF NOT EXISTS worship_song_arrangements (
  id UUID PRIMARY KEY,
  song_id UUID NOT NULL REFERENCES worship_songs(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  musical_key TEXT NOT NULL DEFAULT '' CHECK (length(musical_key) <= 16),
  chart_url TEXT NOT NULL DEFAULT '' CHECK (length(chart_url) <= 2048),
  audio_url TEXT NOT NULL DEFAULT '' CHECK (length(audio_url) <= 2048),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS worship_song_arrangements_song_idx
  ON worship_song_arrangements (song_id, name);

CREATE TABLE IF NOT EXISTS service_plan_templates (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  positions JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(positions) = 'array'),
  items JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items) = 'array'),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_plan_templates_department_idx
  ON service_plan_templates (department_id, lower(name));

