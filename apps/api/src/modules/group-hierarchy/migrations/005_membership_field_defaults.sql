ALTER TABLE group_member_field_definitions
  ADD COLUMN IF NOT EXISTS default_value JSONB
    CHECK (default_value IS NULL OR jsonb_typeof(default_value) IN ('string','number','boolean'));
