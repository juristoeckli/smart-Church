ALTER TABLE people_record_fields ADD COLUMN IF NOT EXISTS tag_color TEXT
  CHECK (tag_color IS NULL OR
    (tag_color ~ '^#[0-9a-f]{6}$' AND field_type = 'boolean' AND NOT required AND field_key ~ '^tag_[a-z0-9_]+$'));
