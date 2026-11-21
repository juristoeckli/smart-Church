ALTER TABLE resource_bookings ADD COLUMN IF NOT EXISTS subtitle text NOT NULL DEFAULT '' CHECK (length(subtitle) <= 240);
