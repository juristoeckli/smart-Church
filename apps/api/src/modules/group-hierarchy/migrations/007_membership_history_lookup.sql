CREATE INDEX IF NOT EXISTS group_hierarchy_history_membership_lookup_idx
  ON group_hierarchy_history (department_id, group_id, entity_id, created_at DESC)
  WHERE entity_kind = 'membership';
