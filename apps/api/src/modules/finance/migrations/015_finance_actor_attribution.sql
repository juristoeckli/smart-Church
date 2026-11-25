CREATE TABLE IF NOT EXISTS finance_actor_attribution (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  record_table TEXT NOT NULL,
  record_key TEXT NOT NULL,
  actor_slot TEXT NOT NULL,
  actor_id UUID NOT NULL,
  actor_name TEXT NOT NULL,
  legacy_backfill BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (department_id,record_table,record_key,actor_slot)
);

CREATE OR REPLACE FUNCTION finance_capture_actor_attribution() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  current_row JSONB;
  previous_row JSONB;
  row_id TEXT;
  slot TEXT;
  owner UUID;
  owner_name TEXT;
BEGIN
  IF TG_OP='DELETE' THEN
    previous_row := to_jsonb(OLD);
    row_id := CASE WHEN TG_ARGV[0]='department_id' THEN 'self' ELSE previous_row->>TG_ARGV[0] END;
    DELETE FROM finance_actor_attribution
      WHERE department_id=(previous_row->>'department_id')::uuid AND record_table=TG_TABLE_NAME AND record_key=row_id;
    RETURN OLD;
  END IF;

  current_row := to_jsonb(NEW);
  previous_row := CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  row_id := CASE WHEN TG_ARGV[0]='department_id' THEN 'self' ELSE current_row->>TG_ARGV[0] END;
  FOREACH slot IN ARRAY TG_ARGV[1:] LOOP
    owner := (current_row->>slot)::uuid;
    IF owner IS NOT NULL AND ((previous_row->>slot) IS DISTINCT FROM (current_row->>slot) OR (slot='updated_by' AND previous_row->>'updated_at' IS DISTINCT FROM current_row->>'updated_at')) THEN
      SELECT display_name INTO owner_name FROM app_users WHERE id=owner;
      IF FOUND THEN
        INSERT INTO finance_actor_attribution(department_id,record_table,record_key,actor_slot,actor_id,actor_name)
          VALUES((current_row->>'department_id')::uuid,TG_TABLE_NAME,row_id,slot,owner,owner_name)
        ON CONFLICT (department_id,record_table,record_key,actor_slot)
          DO UPDATE SET actor_id=EXCLUDED.actor_id,actor_name=EXCLUDED.actor_name,legacy_backfill=false;
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DO $finance$
DECLARE
  relation TEXT;
  primary_field TEXT;
  actor_slots TEXT[];
  actor_slot TEXT;
  trigger_args TEXT;
BEGIN
  FOR relation,primary_field,actor_slots IN
    SELECT * FROM (VALUES
      ('finance_accounting_years','accounting_year',ARRAY['created_by','updated_by']),
      ('finance_budgets','id',ARRAY['created_by']),
      ('finance_transactions','id',ARRAY['created_by']),
      ('finance_year_end_transfers','id',ARRAY['created_by']),
      ('finance_receipt_settings','department_id',ARRAY['updated_by']),
      ('finance_receipt_batches','id',ARRAY['created_by']),
      ('finance_bank_statement_imports','id',ARRAY['imported_by']),
      ('finance_bank_statement_rows','id',ARRAY['reconciled_by']),
      ('finance_bank_suggestion_rules','id',ARRAY['created_by','updated_by']),
      ('finance_transaction_evidence','id',ARRAY['uploaded_by']),
      ('finance_audit','id',ARRAY['actor_user_id'])
    ) AS inventory(relation,primary_field,actor_slots)
  LOOP
    FOREACH actor_slot IN ARRAY actor_slots LOOP
      EXECUTE format(
        'INSERT INTO finance_actor_attribution(department_id,record_table,record_key,actor_slot,actor_id,actor_name,legacy_backfill)
         SELECT item.department_id,%L,%s,%L,account.id,account.display_name,true
           FROM %I item JOIN app_users account ON account.id=item.%I
         ON CONFLICT DO NOTHING',
        relation,CASE WHEN primary_field='department_id' THEN quote_literal('self') ELSE format('item.%I::text',primary_field) END,
        actor_slot,relation,actor_slot);
    END LOOP;
    SELECT string_agg(quote_literal(argument),',' ORDER BY position)
      INTO trigger_args FROM unnest(ARRAY[primary_field] || actor_slots) WITH ORDINALITY AS args(argument,position);
    EXECUTE format('DROP TRIGGER IF EXISTS finance_actor_attribution_history ON %I',relation);
    EXECUTE format('CREATE TRIGGER finance_actor_attribution_history AFTER INSERT OR UPDATE OR DELETE ON %I
      FOR EACH ROW EXECUTE FUNCTION finance_capture_actor_attribution(%s)',relation,trigger_args);
  END LOOP;
END
$finance$;
