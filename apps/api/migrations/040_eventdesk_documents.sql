CREATE TABLE IF NOT EXISTS eventdesk_document_sequences (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('quote', 'invoice')),
  last_number INTEGER NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  PRIMARY KEY (department_id, kind)
);

CREATE TABLE IF NOT EXISTS eventdesk_documents (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  job_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('quote', 'invoice')),
  document_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'partial', 'paid', 'cancelled')),
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  customer_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  tax_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 3000),
  subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, department_id),
  UNIQUE (department_id, document_number),
  FOREIGN KEY (job_id, department_id) REFERENCES eventdesk_jobs(id, department_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS eventdesk_documents_department_date_idx ON eventdesk_documents (department_id, issue_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS eventdesk_documents_job_idx ON eventdesk_documents (department_id, job_id);

CREATE TABLE IF NOT EXISTS eventdesk_document_payments (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  document_id UUID NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  paid_at DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (document_id, department_id) REFERENCES eventdesk_documents(id, department_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS eventdesk_document_payments_document_idx ON eventdesk_document_payments (department_id, document_id, paid_at);
