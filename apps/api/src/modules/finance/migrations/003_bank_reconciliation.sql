CREATE TABLE IF NOT EXISTS finance_bank_statement_imports (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  account_id UUID NOT NULL,
  file_name VARCHAR(180) NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  imported_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count BETWEEN 0 AND 20000),
  UNIQUE(department_id,id),
  UNIQUE(department_id,account_id,content_sha256),
  FOREIGN KEY(department_id,account_id) REFERENCES finance_accounts(department_id,id)
);

CREATE TABLE IF NOT EXISTS finance_bank_statement_rows (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  import_id UUID NOT NULL,
  line_number INTEGER NOT NULL CHECK(line_number > 1),
  booking_date DATE NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  reference VARCHAR(180) NOT NULL DEFAULT '',
  amount_cents BIGINT NOT NULL CHECK(amount_cents <> 0),
  status VARCHAR(12) NOT NULL DEFAULT 'unmatched' CHECK(status IN ('unmatched','suggested','matched','ignored')),
  suggested_transaction_id UUID,
  matched_transaction_id UUID,
  reconciled_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  reconciled_at TIMESTAMPTZ,
  UNIQUE(department_id,import_id,line_number),
  FOREIGN KEY(department_id,import_id) REFERENCES finance_bank_statement_imports(department_id,id) ON DELETE CASCADE,
  FOREIGN KEY(department_id,suggested_transaction_id) REFERENCES finance_transactions(department_id,id),
  FOREIGN KEY(department_id,matched_transaction_id) REFERENCES finance_transactions(department_id,id),
  CHECK((status='matched' AND matched_transaction_id IS NOT NULL AND reconciled_at IS NOT NULL) OR status<>'matched')
);

CREATE INDEX IF NOT EXISTS finance_bank_rows_import_idx ON finance_bank_statement_rows(department_id,import_id,line_number);
CREATE INDEX IF NOT EXISTS finance_bank_rows_match_idx ON finance_bank_statement_rows(department_id,status,booking_date,amount_cents);

CREATE OR REPLACE FUNCTION finance_prevent_bank_import_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='finance_bank_statement_imports' THEN
    IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM departments WHERE id=OLD.department_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Imported bank statement files are immutable.';
  END IF;
  IF TG_OP='UPDATE' AND OLD.status IN ('unmatched','suggested') AND NEW.status IN ('matched','ignored')
    AND NEW.id=OLD.id AND NEW.department_id=OLD.department_id AND NEW.import_id=OLD.import_id
    AND NEW.line_number=OLD.line_number AND NEW.booking_date=OLD.booking_date AND NEW.description=OLD.description
    AND NEW.reference=OLD.reference AND NEW.amount_cents=OLD.amount_cents
    AND NEW.suggested_transaction_id IS NOT DISTINCT FROM OLD.suggested_transaction_id
    AND ((NEW.status='matched' AND NEW.matched_transaction_id IS NOT NULL AND NEW.reconciled_at IS NOT NULL)
      OR (NEW.status='ignored' AND NEW.matched_transaction_id IS NULL)) THEN RETURN NEW; END IF;
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM departments WHERE id=OLD.department_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Bank statement rows cannot be edited after import.';
END;
$$;
DROP TRIGGER IF EXISTS finance_bank_import_immutable ON finance_bank_statement_imports;
CREATE TRIGGER finance_bank_import_immutable BEFORE UPDATE OR DELETE ON finance_bank_statement_imports FOR EACH ROW EXECUTE FUNCTION finance_prevent_bank_import_mutation();
DROP TRIGGER IF EXISTS finance_bank_row_immutable ON finance_bank_statement_rows;
CREATE TRIGGER finance_bank_row_immutable BEFORE UPDATE OR DELETE ON finance_bank_statement_rows FOR EACH ROW EXECUTE FUNCTION finance_prevent_bank_import_mutation();
