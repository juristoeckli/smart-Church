ALTER TABLE signage_displays ADD COLUMN IF NOT EXISTS fullscreen_state text;
ALTER TABLE signage_displays ADD COLUMN IF NOT EXISTS fullscreen_action text NOT NULL DEFAULT 'enter';
ALTER TABLE signage_displays ADD COLUMN IF NOT EXISTS display_metrics jsonb;
