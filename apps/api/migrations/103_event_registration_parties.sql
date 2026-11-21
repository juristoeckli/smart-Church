ALTER TABLE event_registrations ADD COLUMN additional_attendee BOOLEAN NOT NULL DEFAULT false;

DROP INDEX event_registrations_active_event_email_idx;
CREATE UNIQUE INDEX event_registrations_active_event_email_idx
  ON event_registrations (event_id, lower(email))
  WHERE status IN ('registered', 'waitlisted') AND NOT additional_attendee;

CREATE INDEX event_registrations_active_contact_email_idx
  ON event_registrations (event_id, lower(email))
  WHERE status IN ('registered', 'waitlisted');
