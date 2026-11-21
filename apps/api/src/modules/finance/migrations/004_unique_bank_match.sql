CREATE UNIQUE INDEX IF NOT EXISTS finance_bank_transaction_match_once_idx
  ON finance_bank_statement_rows(department_id,matched_transaction_id)
  WHERE status='matched' AND matched_transaction_id IS NOT NULL;
