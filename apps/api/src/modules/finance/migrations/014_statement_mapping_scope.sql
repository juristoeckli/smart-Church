ALTER TABLE finance_settings ADD COLUMN IF NOT EXISTS statement_mapping_scope UUID;

INSERT INTO finance_settings(department_id,statement_mapping_scope)
SELECT DISTINCT department_id,department_id
FROM finance_bank_statement_account_mappings
ON CONFLICT(department_id) DO UPDATE
  SET statement_mapping_scope=EXCLUDED.statement_mapping_scope
  WHERE finance_settings.statement_mapping_scope IS NULL;
