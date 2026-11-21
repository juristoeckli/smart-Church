CREATE TABLE IF NOT EXISTS event_registration_waitlist_notices (
  registration_id UUID PRIMARY KEY REFERENCES event_registrations(id) ON DELETE CASCADE,
  department_id UUID NOT NULL,
  user_id UUID NOT NULL,
  opted_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id,department_id) REFERENCES department_memberships(user_id,department_id) ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION finish_event_registration_waitlist_notice() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'waitlisted' OR NEW.status NOT IN ('registered','cancelled') THEN RETURN NEW; END IF;
  IF NEW.status='registered' AND to_regclass('public.module_notifications') IS NOT NULL THEN
    INSERT INTO module_notifications(id,department_id,recipient_user_id,kind,title,body,related_event_id,in_app_enabled,email_enabled)
    SELECT gen_random_uuid(),event.department_id,notice.user_id,'announcement',
           left('Waitlist place confirmed: ' || event.title,120),
           left('A place from your registration for “' || event.title || '” is now confirmed.',2000),event.id,true,false
      FROM event_registration_waitlist_notices notice
      JOIN service_events event ON event.id=NEW.event_id AND event.department_id=notice.department_id
      JOIN department_memberships membership ON membership.department_id=event.department_id AND membership.user_id=notice.user_id
      JOIN app_users account ON account.id=membership.user_id AND lower(btrim(account.email))=lower(btrim(NEW.email))
     WHERE notice.registration_id=NEW.id AND event.cancelled_at IS NULL AND event.event_date>=CURRENT_DATE;
  END IF;
  DELETE FROM event_registration_waitlist_notices WHERE registration_id=NEW.id;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS event_registration_waitlist_notice ON event_registrations;
CREATE TRIGGER event_registration_waitlist_notice AFTER UPDATE OF status ON event_registrations
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION finish_event_registration_waitlist_notice();
