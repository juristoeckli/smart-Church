ALTER TABLE saved_report_definitions
  DROP CONSTRAINT IF EXISTS saved_report_definitions_report_key_check;

ALTER TABLE saved_report_definitions
  ADD CONSTRAINT saved_report_definitions_report_key_check
  CHECK (report_key IN (
    'people-directory','upcoming-birthdays','upcoming-anniversaries',
    'group-summary','group-roster','group-meeting-attendance',
    'event-attendance','event-staffing','check-in-trend','visitor-follow-up',
    'worship-song-usage','resource-bookings','finance-account-summary'
  ));
