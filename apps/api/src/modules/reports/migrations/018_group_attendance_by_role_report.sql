ALTER TABLE saved_report_definitions
  DROP CONSTRAINT IF EXISTS saved_report_definitions_report_key_check;

ALTER TABLE saved_report_definitions
  ADD CONSTRAINT saved_report_definitions_report_key_check
  CHECK (report_key IN (
    'people-directory','people-consent-history','people-status-changes','people-first-contact-trend','upcoming-birthdays','upcoming-anniversaries',
    'group-summary','group-roster','group-leaders','group-hierarchy','group-growth','group-meeting-attendance','group-attendance-by-role','group-meeting-feedback','group-lifecycle',
    'event-attendance','event-staffing','event-absence-conflicts','event-service-plan','event-registration-summary','event-registration-details',
    'check-in-trend','visitor-follow-up','worship-song-usage',
    'resource-bookings','resource-utilization','finance-account-summary','finance-budget-vs-actual',
    'finance-donor-giving'
  ));
