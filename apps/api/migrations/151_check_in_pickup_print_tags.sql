ALTER TABLE check_in_label_templates
  ADD COLUMN pickup_tag_ids UUID[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT check_in_pickup_print_tag_limit CHECK (cardinality(pickup_tag_ids) <= 50);
