DO $$
BEGIN
  IF to_regclass('public.module_notifications') IS NOT NULL THEN
    ALTER TABLE module_notifications DROP CONSTRAINT IF EXISTS module_notifications_kind_check;
    ALTER TABLE module_notifications ADD CONSTRAINT module_notifications_kind_check
      CHECK (kind IN ('announcement','event_reminder','service_request','follow_up_assignment','follow_up_reminder','community_feed','report_ready'));
  END IF;
END $$;
