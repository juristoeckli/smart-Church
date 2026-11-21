ALTER TABLE resource_booking_series ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000);
