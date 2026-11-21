ALTER TABLE saved_report_definitions
  DROP CONSTRAINT IF EXISTS saved_report_definitions_report_key_check;

ALTER TABLE saved_report_definitions
  ADD CONSTRAINT saved_report_definitions_report_key_check
  CHECK (report_key IN ('people-directory','group-summary','group-roster','event-attendance','event-staffing','visitor-follow-up','finance-account-summary'));
