ALTER TABLE eventdesk_document_sequences
  DROP CONSTRAINT IF EXISTS eventdesk_document_sequences_kind_check,
  ADD CONSTRAINT eventdesk_document_sequences_kind_check CHECK (kind IN ('quote', 'invoice', 'contract', 'delivery_note'));

ALTER TABLE eventdesk_documents
  DROP CONSTRAINT IF EXISTS eventdesk_documents_kind_check,
  ADD CONSTRAINT eventdesk_documents_kind_check CHECK (kind IN ('quote', 'invoice', 'contract', 'delivery_note'));

ALTER TABLE eventdesk_documents
  DROP CONSTRAINT IF EXISTS eventdesk_documents_status_check,
  ADD CONSTRAINT eventdesk_documents_status_check CHECK (status IN ('draft', 'sent', 'accepted', 'signed', 'rejected', 'partial', 'paid', 'cancelled', 'returned'));
