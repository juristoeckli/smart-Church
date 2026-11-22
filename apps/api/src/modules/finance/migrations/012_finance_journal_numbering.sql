CREATE TABLE IF NOT EXISTS finance_journal_numbering (
  department_id UUID NOT NULL,
  accounting_year SMALLINT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number BETWEEN 1 AND 1000000000),
  PRIMARY KEY (department_id, accounting_year),
  FOREIGN KEY (department_id, accounting_year) REFERENCES finance_accounting_years(department_id, accounting_year) ON DELETE CASCADE
);

ALTER TABLE finance_transactions ADD COLUMN IF NOT EXISTS journal_sequence INTEGER
  CHECK (journal_sequence BETWEEN 1 AND 999999999);

CREATE UNIQUE INDEX IF NOT EXISTS finance_transactions_journal_sequence_unique
  ON finance_transactions(department_id, accounting_year, journal_sequence) WHERE journal_sequence IS NOT NULL;

CREATE INDEX IF NOT EXISTS finance_transactions_journal_receipt_lookup
  ON finance_transactions(department_id, accounting_year, receipt_number);

CREATE OR REPLACE FUNCTION finance_guard_journal_receipt_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.journal_sequence IS NULL
     AND NEW.receipt_number !~ ('^J-' || NEW.accounting_year || '-[0-9]{6,9}$') THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('finance-journal-numbering:' || NEW.department_id || ':' || NEW.accounting_year));
  IF NEW.journal_sequence IS NOT NULL AND NEW.receipt_number <> 'J-' || NEW.accounting_year || '-' ||
       lpad(NEW.journal_sequence::text, greatest(6, length(NEW.journal_sequence::text)), '0') THEN
    RAISE EXCEPTION 'Automatic receipt number does not match its journal sequence' USING ERRCODE='23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM finance_transactions t
    WHERE t.department_id=NEW.department_id AND t.accounting_year=NEW.accounting_year AND t.id<>NEW.id
      AND t.receipt_number=NEW.receipt_number AND (t.journal_sequence IS NOT NULL OR NEW.journal_sequence IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Receipt number is already allocated' USING ERRCODE='23505', CONSTRAINT='finance_journal_receipt_allocated';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_guard_journal_receipt_number ON finance_transactions;
CREATE TRIGGER finance_guard_journal_receipt_number BEFORE INSERT OR UPDATE OF receipt_number,accounting_year,journal_sequence
  ON finance_transactions FOR EACH ROW EXECUTE FUNCTION finance_guard_journal_receipt_number();
