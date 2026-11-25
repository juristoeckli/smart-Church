CREATE TABLE finance_bank_statement_archive (
  department_id uuid NOT NULL,
  import_id uuid NOT NULL,
  archived boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(department_id, import_id),
  FOREIGN KEY(department_id, import_id) REFERENCES finance_bank_statement_imports(department_id, id) ON DELETE CASCADE
);
