ALTER TABLE saved_report_definitions ADD COLUMN run_history JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE saved_designer_reports ADD COLUMN run_history JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE saved_report_definitions
SET run_history=jsonb_build_array(jsonb_build_object('ranAt',last_run_at,'status',last_run_status))
WHERE last_run_at IS NOT NULL AND last_run_status IS NOT NULL;

UPDATE saved_designer_reports
SET run_history=jsonb_build_array(jsonb_build_object('ranAt',last_run_at,'status',last_run_status))
WHERE last_run_at IS NOT NULL AND last_run_status IS NOT NULL;
