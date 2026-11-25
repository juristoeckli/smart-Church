CREATE TABLE IF NOT EXISTS finance_booking_purposes (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  id UUID NOT NULL,
  name VARCHAR(120) NOT NULL CHECK (length(trim(name)) > 0),
  direction TEXT NOT NULL CHECK (direction IN ('income', 'expense')),
  bank_account_id UUID NOT NULL,
  counter_account_id UUID NOT NULL,
  cost_center_id UUID NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 10000),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, id),
  FOREIGN KEY (department_id, bank_account_id) REFERENCES finance_accounts(department_id, id),
  FOREIGN KEY (department_id, counter_account_id) REFERENCES finance_accounts(department_id, id),
  FOREIGN KEY (department_id, cost_center_id) REFERENCES finance_cost_centers(department_id, id),
  CHECK (bank_account_id <> counter_account_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_booking_purposes_department_name
  ON finance_booking_purposes (department_id, lower(name));
