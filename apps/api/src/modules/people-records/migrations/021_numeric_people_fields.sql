ALTER TABLE people_record_fields
  DROP CONSTRAINT people_record_fields_field_type_check,
  DROP CONSTRAINT people_record_fields_check1,
  ADD CONSTRAINT people_record_fields_field_type_check
    CHECK (field_type IN ('text', 'date', 'boolean', 'select', 'number')),
  ADD CONSTRAINT people_record_fields_text_max_length_check
    CHECK (text_max_length IS NULL OR (field_type IN ('text', 'number') AND text_max_length BETWEEN 1 AND 2000));
