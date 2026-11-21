ALTER TABLE saved_report_definitions
  ADD COLUMN schedule_days INTEGER CHECK (schedule_days IN (1, 7)),
  ADD COLUMN next_run_at TIMESTAMPTZ,
  ADD COLUMN last_run_at TIMESTAMPTZ,
  ADD COLUMN last_run_status TEXT CHECK (last_run_status IN ('ready', 'unavailable', 'failed', 'too_large')),
  ADD COLUMN scheduled_result JSONB;

CREATE INDEX saved_report_definitions_due_idx
  ON saved_report_definitions(next_run_at) WHERE next_run_at IS NOT NULL;
