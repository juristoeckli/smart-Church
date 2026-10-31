ALTER TABLE signage_displays ADD COLUMN IF NOT EXISTS reload_version integer NOT NULL DEFAULT 0;
ALTER TABLE signage_displays ADD COLUMN IF NOT EXISTS clock_offset_ms double precision;
ALTER TABLE signage_displays ADD COLUMN IF NOT EXISTS clock_round_trip_ms double precision;
