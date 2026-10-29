ALTER TABLE eventdesk_document_sequences
  DROP CONSTRAINT IF EXISTS eventdesk_document_sequences_kind_check,
  ADD CONSTRAINT eventdesk_document_sequences_kind_check CHECK (kind IN ('quote', 'invoice', 'deposit_invoice', 'contract', 'delivery_note'));

ALTER TABLE eventdesk_documents
  DROP CONSTRAINT IF EXISTS eventdesk_documents_kind_check,
  ADD CONSTRAINT eventdesk_documents_kind_check CHECK (kind IN ('quote', 'invoice', 'deposit_invoice', 'contract', 'delivery_note'));

CREATE INDEX IF NOT EXISTS eventdesk_documents_overdue_idx
  ON eventdesk_documents (department_id, due_date)
  WHERE kind IN ('invoice', 'deposit_invoice') AND status IN ('sent', 'partial');
