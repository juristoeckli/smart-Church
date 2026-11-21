CREATE TABLE finance_tax_types (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL CHECK (length(trim(code)) > 0),
  name VARCHAR(160) NOT NULL CHECK (length(trim(name)) > 0),
  rate_basis_points INTEGER CHECK (rate_basis_points BETWEEN 0 AND 10000),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX finance_tax_types_department_code
  ON finance_tax_types(department_id,lower(code));
