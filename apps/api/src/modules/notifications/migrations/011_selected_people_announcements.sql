ALTER TABLE module_notification_announcement_batches
  DROP CONSTRAINT IF EXISTS module_notification_announcement_batches_audience_check;

ALTER TABLE module_notification_announcement_batches
  ADD CONSTRAINT module_notification_announcement_batches_audience_check
  CHECK (audience IN ('location', 'groups', 'people'));
