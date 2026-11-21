ALTER TABLE service_events
  ADD COLUMN responsible_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;
