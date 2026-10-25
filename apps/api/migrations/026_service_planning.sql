ALTER TABLE service_events
  ADD COLUMN IF NOT EXISTS room TEXT NOT NULL DEFAULT '' CHECK (length(room) <= 160),
  ADD COLUMN IF NOT EXISTS asset_ids UUID[] NOT NULL DEFAULT ARRAY[]::uuid[],
  ADD COLUMN IF NOT EXISTS positions JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(positions) = 'array'),
  ADD COLUMN IF NOT EXISTS time_plan JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(time_plan) = 'array');
