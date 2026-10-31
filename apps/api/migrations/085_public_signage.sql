CREATE TABLE IF NOT EXISTS signage_shows (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  slides JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(slides) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id, id)
);

CREATE TABLE IF NOT EXISTS signage_displays (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  service_user_id UUID NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  installation_type TEXT,
  last_ip_address INET,
  last_seen_at TIMESTAMPTZ,
  uptime_seconds BIGINT NOT NULL DEFAULT 0 CHECK (uptime_seconds >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id, id)
);

CREATE TABLE IF NOT EXISTS signage_schedules (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  display_id UUID NOT NULL,
  show_id UUID NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  FOREIGN KEY (department_id, display_id) REFERENCES signage_displays(department_id, id) ON DELETE CASCADE,
  FOREIGN KEY (department_id, show_id) REFERENCES signage_shows(department_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS signage_schedules_display_time_idx
  ON signage_schedules (department_id, display_id, starts_at, ends_at);
