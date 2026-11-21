ALTER TABLE saved_report_definitions
  ADD COLUMN notify_when_ready BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE saved_designer_reports
  ADD COLUMN notify_when_ready BOOLEAN NOT NULL DEFAULT false;
