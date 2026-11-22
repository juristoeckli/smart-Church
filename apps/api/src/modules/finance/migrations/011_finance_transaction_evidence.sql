CREATE TABLE IF NOT EXISTS finance_transaction_evidence (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  transaction_id UUID NOT NULL,
  file_name TEXT NOT NULL CHECK (length(file_name) BETWEEN 1 AND 180),
  file_size INTEGER NOT NULL CHECK (file_size BETWEEN 1 AND 10485760),
  file_data BYTEA NOT NULL CHECK (octet_length(file_data) = file_size),
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  uploaded_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (department_id, transaction_id) REFERENCES finance_transactions(department_id, id) ON DELETE CASCADE,
  UNIQUE (department_id, transaction_id, content_hash)
);
