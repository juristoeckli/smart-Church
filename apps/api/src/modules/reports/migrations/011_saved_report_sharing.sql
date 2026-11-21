ALTER TABLE saved_report_definitions
  ADD COLUMN IF NOT EXISTS share_scope TEXT NOT NULL DEFAULT 'private'
    CHECK (share_scope IN ('private','department'));

ALTER TABLE saved_designer_reports
  ADD COLUMN IF NOT EXISTS share_scope TEXT NOT NULL DEFAULT 'private'
    CHECK (share_scope IN ('private','department'));

CREATE INDEX IF NOT EXISTS saved_report_definitions_sharing_idx
  ON saved_report_definitions(department_id,share_scope,lower(name));

CREATE INDEX IF NOT EXISTS saved_designer_reports_sharing_idx
  ON saved_designer_reports(department_id,share_scope,lower(name));
