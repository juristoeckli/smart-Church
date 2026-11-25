CREATE TABLE IF NOT EXISTS finance_simple_booking_grants (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  id UUID NOT NULL,
  group_id UUID NOT NULL,
  membership_role TEXT NOT NULL CHECK (length(trim(membership_role)) BETWEEN 1 AND 80),
  cost_center_id UUID NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, id),
  FOREIGN KEY (department_id, cost_center_id) REFERENCES finance_cost_centers(department_id, id)
);

-- Group IDs are checked against the live Core location at authorization time.
-- Keeping the ID without a cross-module FK lets Core replace its signed group records.
CREATE UNIQUE INDEX IF NOT EXISTS finance_simple_booking_grant_scope
  ON finance_simple_booking_grants (department_id, group_id, lower(membership_role), cost_center_id);
