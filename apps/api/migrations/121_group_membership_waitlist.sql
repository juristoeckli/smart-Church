ALTER TABLE group_members
  ADD COLUMN waitlisted_at TIMESTAMPTZ,
  ADD COLUMN waitlist_priority INTEGER CHECK (waitlist_priority IS NULL OR (status='waitlist' AND waitlist_priority > 0));

CREATE INDEX group_members_waitlist_order_idx
  ON group_members(group_id,waitlist_priority,COALESCE(waitlisted_at,added_at),contact_id)
  WHERE status='waitlist';

CREATE FUNCTION smart_church_set_group_waitlist_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'waitlist' THEN
    NEW.waitlist_priority := NULL;
    NEW.waitlisted_at := NULL;
  ELSIF OLD.status <> 'waitlist' THEN
    NEW.waitlist_priority := NULL;
    NEW.waitlisted_at := statement_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER group_member_set_waitlist_order
  BEFORE UPDATE OF status ON group_members
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION smart_church_set_group_waitlist_order();
