DROP TRIGGER IF EXISTS finance_balance_transaction_promotion ON finance_transactions;
CREATE CONSTRAINT TRIGGER finance_balance_transaction_promotion AFTER UPDATE ON finance_transactions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD.status = 'draft' AND NEW.status = 'posted')
  EXECUTE FUNCTION finance_enforce_balanced_transaction();
