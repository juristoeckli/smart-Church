ALTER TABLE group_signup_forms
  ADD COLUMN active_seat_limit INTEGER CHECK (active_seat_limit BETWEEN 1 AND 100000),
  ADD COLUMN waitlist_limit INTEGER CHECK (waitlist_limit BETWEEN 0 AND 100000),
  ADD COLUMN counted_roles TEXT[] NOT NULL DEFAULT ARRAY[]::text[] CHECK (cardinality(counted_roles)<=40);
