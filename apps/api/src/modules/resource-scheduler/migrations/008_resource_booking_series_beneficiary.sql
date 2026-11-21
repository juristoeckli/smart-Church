ALTER TABLE resource_booking_series ADD COLUMN IF NOT EXISTS beneficiary_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS resource_booking_series_beneficiary_contact_idx ON resource_booking_series(beneficiary_contact_id) WHERE beneficiary_contact_id IS NOT NULL;
