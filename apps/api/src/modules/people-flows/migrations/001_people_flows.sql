CREATE TABLE IF NOT EXISTS people_flows (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id,id)
);

CREATE TABLE IF NOT EXISTS people_flow_steps (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  flow_id UUID NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  instructions TEXT NOT NULL DEFAULT '' CHECK (length(instructions) <= 4000),
  position INTEGER NOT NULL CHECK (position >= 0),
  due_after_days INTEGER CHECK (due_after_days IS NULL OR due_after_days BETWEEN 0 AND 3650),
  required BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id,id),
  FOREIGN KEY (department_id,flow_id) REFERENCES people_flows(department_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS people_flow_enrollments (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  flow_id UUID NOT NULL,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  due_on DATE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id,id),
  FOREIGN KEY (department_id,flow_id) REFERENCES people_flows(department_id,id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS people_flow_enrollments_active_unique_idx
  ON people_flow_enrollments(department_id,flow_id,contact_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS people_flow_enrollments_contact_idx
  ON people_flow_enrollments(department_id,contact_id,status);

CREATE TABLE IF NOT EXISTS people_flow_step_progress (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  enrollment_id UUID NOT NULL,
  step_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','skipped')),
  due_on DATE,
  completed_at TIMESTAMPTZ,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id,enrollment_id,step_id),
  FOREIGN KEY (department_id,enrollment_id) REFERENCES people_flow_enrollments(department_id,id) ON DELETE CASCADE,
  FOREIGN KEY (department_id,step_id) REFERENCES people_flow_steps(department_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS people_flow_audit (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  actor_user_id UUID,
  action TEXT NOT NULL,
  flow_id UUID,
  enrollment_id UUID,
  step_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS people_flows_department_status_idx ON people_flows(department_id,status,name);
CREATE INDEX IF NOT EXISTS people_flow_steps_order_idx ON people_flow_steps(department_id,flow_id,active,position);
CREATE INDEX IF NOT EXISTS people_flow_audit_recent_idx ON people_flow_audit(department_id,created_at DESC);
