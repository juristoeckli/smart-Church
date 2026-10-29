CREATE TABLE IF NOT EXISTS eventdesk_document_deliveries (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  document_id UUID NOT NULL,
  recipient_email TEXT NOT NULL CHECK (char_length(recipient_email) <= 254),
  subject TEXT NOT NULL CHECK (char_length(subject) <= 240),
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  provider_message_id TEXT NOT NULL DEFAULT '' CHECK (char_length(provider_message_id) <= 300),
  error_summary TEXT NOT NULL DEFAULT '' CHECK (char_length(error_summary) <= 500),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (document_id, department_id) REFERENCES eventdesk_documents(id, department_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS eventdesk_document_deliveries_document_idx
  ON eventdesk_document_deliveries (department_id, document_id, created_at DESC);
