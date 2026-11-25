ALTER TABLE people_record_fields
  ADD COLUMN category TEXT CHECK (category IS NULL OR char_length(category) BETWEEN 1 AND 60);
