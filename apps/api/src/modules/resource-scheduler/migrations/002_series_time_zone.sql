-- Existing series keep the original UTC recurrence rules (NULL means legacy UTC).
-- New series store the department zone so future occurrences follow its local clock.
ALTER TABLE resource_booking_series
  ADD COLUMN IF NOT EXISTS time_zone TEXT;
