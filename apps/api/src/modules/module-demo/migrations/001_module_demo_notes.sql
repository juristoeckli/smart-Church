CREATE TABLE IF NOT EXISTS module_demo_notes (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  message TEXT NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS module_demo_notes_department_created_idx
  ON module_demo_notes (department_id, created_at DESC);
