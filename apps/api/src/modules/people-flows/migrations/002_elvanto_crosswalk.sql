CREATE TABLE IF NOT EXISTS elvanto_people_flow_links (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  source_flow_id TEXT NOT NULL,
  local_flow_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, source_flow_id),
  UNIQUE (department_id, local_flow_id),
  FOREIGN KEY (department_id, local_flow_id)
    REFERENCES people_flows(department_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS elvanto_people_flow_step_links (
  department_id UUID NOT NULL,
  source_flow_id TEXT NOT NULL,
  source_step_id TEXT NOT NULL,
  local_step_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, source_flow_id, source_step_id),
  UNIQUE (department_id, local_step_id),
  FOREIGN KEY (department_id, source_flow_id)
    REFERENCES elvanto_people_flow_links(department_id, source_flow_id) ON DELETE CASCADE,
  FOREIGN KEY (department_id, local_step_id)
    REFERENCES people_flow_steps(department_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS elvanto_people_flow_local_idx
  ON elvanto_people_flow_links (department_id, local_flow_id);
