ALTER TABLE eventdesk_document_sequences
  DROP CONSTRAINT IF EXISTS eventdesk_document_sequences_kind_check,
  ADD CONSTRAINT eventdesk_document_sequences_kind_check CHECK (kind IN ('quote', 'invoice', 'deposit_invoice', 'credit_note', 'contract', 'delivery_note'));

ALTER TABLE eventdesk_documents
  ADD COLUMN IF NOT EXISTS related_document_id UUID;

ALTER TABLE eventdesk_documents
  DROP CONSTRAINT IF EXISTS eventdesk_documents_kind_check,
  ADD CONSTRAINT eventdesk_documents_kind_check CHECK (kind IN ('quote', 'invoice', 'deposit_invoice', 'credit_note', 'contract', 'delivery_note')),
  DROP CONSTRAINT IF EXISTS eventdesk_documents_status_check,
  ADD CONSTRAINT eventdesk_documents_status_check CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'partial', 'paid', 'settled', 'cancelled', 'returned')),
  ADD CONSTRAINT eventdesk_documents_credit_link_check CHECK (
    (kind = 'credit_note' AND related_document_id IS NOT NULL) OR
    (kind <> 'credit_note' AND related_document_id IS NULL)
  ),
  ADD CONSTRAINT eventdesk_documents_related_document_fk
    FOREIGN KEY (related_document_id, department_id)
    REFERENCES eventdesk_documents(id, department_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS eventdesk_documents_related_document_idx
  ON eventdesk_documents (department_id, related_document_id)
  WHERE related_document_id IS NOT NULL;
