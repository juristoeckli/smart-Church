ALTER TABLE eventdesk_document_settings
  ADD COLUMN IF NOT EXISTS qr_bill_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS qr_bill_iban TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS qr_bill_reference_type TEXT NOT NULL DEFAULT 'NON',
  ADD COLUMN IF NOT EXISTS qr_bill_street TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS qr_bill_building_number TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS qr_bill_country_code TEXT NOT NULL DEFAULT 'CH';

ALTER TABLE eventdesk_document_settings
  DROP CONSTRAINT IF EXISTS eventdesk_document_settings_qr_bill_reference_type_check,
  ADD CONSTRAINT eventdesk_document_settings_qr_bill_reference_type_check
    CHECK (qr_bill_reference_type IN ('NON','SCOR','QRR')),
  DROP CONSTRAINT IF EXISTS eventdesk_document_settings_qr_bill_iban_length_check,
  ADD CONSTRAINT eventdesk_document_settings_qr_bill_iban_length_check
    CHECK (char_length(qr_bill_iban) <= 34),
  DROP CONSTRAINT IF EXISTS eventdesk_document_settings_qr_bill_street_check,
  ADD CONSTRAINT eventdesk_document_settings_qr_bill_street_check
    CHECK (char_length(qr_bill_street) <= 70),
  DROP CONSTRAINT IF EXISTS eventdesk_document_settings_qr_bill_building_number_check,
  ADD CONSTRAINT eventdesk_document_settings_qr_bill_building_number_check
    CHECK (char_length(qr_bill_building_number) <= 16),
  DROP CONSTRAINT IF EXISTS eventdesk_document_settings_qr_bill_country_code_check,
  ADD CONSTRAINT eventdesk_document_settings_qr_bill_country_code_check
    CHECK (qr_bill_country_code ~ '^[A-Z]{2}$');
