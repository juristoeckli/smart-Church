CREATE UNIQUE INDEX IF NOT EXISTS church_groups_id_department_key ON church_groups(id,department_id);

CREATE TABLE IF NOT EXISTS group_meeting_pins (
  group_id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -85.05112878 AND 85.05112878),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  FOREIGN KEY (group_id,department_id) REFERENCES church_groups(id,department_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS group_meeting_pins_department_idx ON group_meeting_pins(department_id);

ALTER TABLE group_directory_views DROP CONSTRAINT IF EXISTS group_directory_views_display_mode_check;
ALTER TABLE group_directory_views ADD CONSTRAINT group_directory_views_display_mode_check
  CHECK (display_mode IN ('list','table','map'));
