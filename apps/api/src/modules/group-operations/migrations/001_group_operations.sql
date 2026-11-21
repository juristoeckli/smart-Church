CREATE TABLE IF NOT EXISTS group_routine_definitions (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES church_groups(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description VARCHAR(1000) NOT NULL DEFAULT '',
  cadence VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (cadence IN ('manual','weekly','monthly','quarterly','annually')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id,id)
);

CREATE TABLE IF NOT EXISTS group_routine_runs (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  routine_id UUID NOT NULL REFERENCES group_routine_definitions(id) ON DELETE CASCADE,
  run_date DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed')),
  assigned_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  notes VARCHAR(2000) NOT NULL DEFAULT '',
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  completed_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id,id),
  UNIQUE (department_id,routine_id,run_date),
  FOREIGN KEY (department_id,routine_id) REFERENCES group_routine_definitions(department_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS group_routine_runs_date_idx ON group_routine_runs(department_id,run_date DESC);

CREATE TABLE IF NOT EXISTS group_certificate_definitions (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES church_groups(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description VARCHAR(1000) NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id,id),
  UNIQUE (department_id,id,group_id)
);
CREATE TABLE IF NOT EXISTS group_certificate_issues (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  certificate_id UUID NOT NULL,
  group_id UUID NOT NULL REFERENCES church_groups(id) ON DELETE RESTRICT,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  issued_at DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  notes VARCHAR(1000) NOT NULL DEFAULT '',
  issued_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  revoke_reason VARCHAR(500) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id,id),
  CHECK (valid_until IS NULL OR valid_until >= issued_at),
  FOREIGN KEY (department_id,certificate_id,group_id) REFERENCES group_certificate_definitions(department_id,id,group_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS group_certificate_issues_contact_idx ON group_certificate_issues(department_id,contact_id,issued_at DESC);

CREATE TABLE IF NOT EXISTS group_membership_rule_sets (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES church_groups(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  contact_status TEXT NOT NULL CHECK (contact_status IN ('member','visitor')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id,id)
);

CREATE TABLE IF NOT EXISTS group_operations_audit (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES church_groups(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  action VARCHAR(48) NOT NULL,
  record_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS group_operations_audit_group_idx ON group_operations_audit(department_id,group_id,created_at DESC);
