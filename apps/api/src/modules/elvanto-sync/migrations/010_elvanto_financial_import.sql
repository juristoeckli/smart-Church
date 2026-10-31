ALTER TABLE elvanto_sync_settings
  ADD COLUMN IF NOT EXISTS financial_import_page INTEGER NOT NULL DEFAULT 1 CHECK (financial_import_page >= 1),
  ADD COLUMN IF NOT EXISTS financial_import_total INTEGER,
  ADD COLUMN IF NOT EXISTS financial_import_created_count INTEGER NOT NULL DEFAULT 0 CHECK (financial_import_created_count >= 0),
  ADD COLUMN IF NOT EXISTS financial_import_updated_count INTEGER NOT NULL DEFAULT 0 CHECK (financial_import_updated_count >= 0),
  ADD COLUMN IF NOT EXISTS financial_import_skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (financial_import_skipped_count >= 0),
  ADD COLUMN IF NOT EXISTS financial_import_complete BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS financial_preview_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS financial_preview_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS financial_preview_complete BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS financial_preview_count INTEGER NOT NULL DEFAULT 0 CHECK (financial_preview_count >= 0),
  ADD COLUMN IF NOT EXISTS financial_preview_start_date DATE,
  ADD COLUMN IF NOT EXISTS financial_preview_end_date DATE,
  ADD COLUMN IF NOT EXISTS financial_import_start_date DATE,
  ADD COLUMN IF NOT EXISTS financial_import_end_date DATE,
  ADD COLUMN IF NOT EXISTS financial_importing BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS financial_import_started_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS elvanto_financial_import (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  transaction_date DATE NOT NULL,
  encrypted_payload TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, source_id)
);
CREATE INDEX IF NOT EXISTS elvanto_financial_import_date_idx
  ON elvanto_financial_import (department_id, transaction_date DESC);
