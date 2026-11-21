CREATE TABLE IF NOT EXISTS service_event_fact_definitions (
  id uuid PRIMARY KEY,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  kind text NOT NULL CHECK (kind IN ('number','select')),
  unit text CHECK (length(unit) BETWEEN 1 AND 24),
  options text[] NOT NULL DEFAULT '{}',
  archived_at timestamptz,
  CHECK ((kind='number' AND cardinality(options)=0) OR
         (kind='select' AND unit IS NULL AND cardinality(options) BETWEEN 2 AND 20))
);

CREATE UNIQUE INDEX IF NOT EXISTS service_event_fact_definition_active_label
  ON service_event_fact_definitions(department_id, lower(label)) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS service_event_fact_definitions_location ON service_event_fact_definitions(department_id);
