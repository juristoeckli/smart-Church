ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS time_zone TEXT NOT NULL DEFAULT 'Europe/Zurich',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE departments
  ADD CONSTRAINT departments_time_zone_length CHECK (length(time_zone) BETWEEN 1 AND 80);
