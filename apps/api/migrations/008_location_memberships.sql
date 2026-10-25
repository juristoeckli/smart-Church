ALTER TABLE app_users DROP CONSTRAINT app_users_role_check;
ALTER TABLE app_users
  ADD CONSTRAINT app_users_role_check CHECK (role IN ('server_admin', 'user'));

CREATE TABLE IF NOT EXISTS department_memberships (
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('site_admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, department_id)
);

CREATE INDEX IF NOT EXISTS department_memberships_department_idx
  ON department_memberships (department_id, user_id);

-- Preserve access for existing administrators through explicit membership rows.
INSERT INTO department_memberships (user_id, department_id, role)
SELECT u.id, d.id, 'site_admin'
  FROM app_users u
 CROSS JOIN departments d
 WHERE u.role = 'server_admin'
ON CONFLICT (user_id, department_id) DO NOTHING;
