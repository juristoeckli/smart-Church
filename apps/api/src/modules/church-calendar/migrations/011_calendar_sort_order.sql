ALTER TABLE church_calendar_calendars ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0);
