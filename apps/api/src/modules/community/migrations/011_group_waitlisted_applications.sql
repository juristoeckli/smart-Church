ALTER TABLE group_join_requests DROP CONSTRAINT group_join_requests_status_check;
ALTER TABLE group_join_requests ADD CONSTRAINT group_join_requests_status_check
  CHECK (status IN ('pending','approved','declined','waitlisted'));
