ALTER TABLE people_record_fields
  DROP CONSTRAINT people_record_fields_field_type_check,
  ADD CONSTRAINT people_record_fields_field_type_check
    CHECK (field_type IN ('text', 'date', 'boolean', 'select', 'number', 'multiline', 'datetime'));
