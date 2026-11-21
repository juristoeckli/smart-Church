ALTER TABLE resource_bookings ADD COLUMN IF NOT EXISTS beneficiary_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS resource_bookings_beneficiary_contact_idx ON resource_bookings(beneficiary_contact_id) WHERE beneficiary_contact_id IS NOT NULL;
