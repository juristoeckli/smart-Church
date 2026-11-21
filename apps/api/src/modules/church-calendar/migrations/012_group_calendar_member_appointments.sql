ALTER TABLE church_calendar_calendars ADD COLUMN IF NOT EXISTS allow_member_appointments boolean NOT NULL DEFAULT false CHECK (scope='group' OR NOT allow_member_appointments);
