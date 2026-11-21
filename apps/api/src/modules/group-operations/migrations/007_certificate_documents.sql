ALTER TABLE group_certificate_definitions ADD COLUMN document_text TEXT NOT NULL DEFAULT ''
  CHECK (length(document_text) <= 1000);
