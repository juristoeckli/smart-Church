CREATE TABLE IF NOT EXISTS group_meeting_places (
  group_id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  place JSONB NOT NULL CHECK (jsonb_typeof(place)='object'
    AND COALESCE(place->>'visibility' IN ('managers','members'),false)),
  FOREIGN KEY (group_id,department_id) REFERENCES church_groups(id,department_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS group_meeting_places_department_idx ON group_meeting_places(department_id);
