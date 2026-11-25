ALTER TABLE module_notifications DROP CONSTRAINT IF EXISTS module_notifications_kind_check;
ALTER TABLE module_notifications ADD CONSTRAINT module_notifications_kind_check CHECK (kind IN (
  'announcement','event_reminder','service_request','follow_up_assignment','follow_up_reminder','community_feed',
  'report_ready','resource_booking','resource_booking_request','calendar_appointment_updated','calendar_meeting_request','calendar_new_appointments'
));
