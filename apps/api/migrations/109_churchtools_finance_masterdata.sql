CREATE TABLE IF NOT EXISTS churchtools_migration_finance_links (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  instance_url TEXT NOT NULL,
  period_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('account','cost_center')),
  source_id TEXT NOT NULL,
  target_id UUID NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id,instance_url,period_id,kind,source_id),
  UNIQUE (department_id,instance_url,period_id,kind,target_id)
);

CREATE TABLE IF NOT EXISTS churchtools_migration_finance_receipts (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  instance_url TEXT NOT NULL,
  period_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  result JSONB NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id,instance_url,period_id,batch_id)
);
