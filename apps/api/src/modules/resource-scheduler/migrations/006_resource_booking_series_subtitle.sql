ALTER TABLE resource_booking_series ADD COLUMN IF NOT EXISTS subtitle text NOT NULL DEFAULT '' CHECK (length(subtitle) <= 240);
