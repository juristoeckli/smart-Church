ALTER TABLE people_record_fields
  ADD COLUMN text_max_length INTEGER CHECK (
    text_max_length IS NULL OR (field_type = 'text' AND text_max_length BETWEEN 1 AND 2000)
  );
