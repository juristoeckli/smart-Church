CREATE TABLE IF NOT EXISTS churchtools_migration_finance_split_draft_children (
  department_id UUID NOT NULL,
  instance_url TEXT NOT NULL,
  period_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  parent_link_id TEXT NOT NULL,
  PRIMARY KEY (department_id,instance_url,period_id,source_id),
  FOREIGN KEY (department_id,instance_url,period_id,parent_link_id)
    REFERENCES churchtools_migration_finance_journal_links(department_id,instance_url,period_id,source_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS churchtools_migration_finance_split_children_parent_idx
  ON churchtools_migration_finance_split_draft_children(department_id,instance_url,period_id,parent_link_id);
