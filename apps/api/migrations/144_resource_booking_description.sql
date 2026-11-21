ALTER TABLE resource_bookings ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000);
