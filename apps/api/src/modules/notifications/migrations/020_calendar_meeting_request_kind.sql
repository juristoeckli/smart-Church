DO $$
BEGIN
  IF to_regclass('public.module_notifications') IS NOT NULL THEN
    ALTER TABLE module_notifications DROP CONSTRAINT IF EXISTS module_notifications_kind_check;
    ALTER TABLE module_notifications ADD CONSTRAINT module_notifications_kind_check
      CHECK (kind IN ('announcement','event_reminder','service_request','follow_up_assignment','follow_up_reminder','community_feed',
                      'report_ready','resource_booking','resource_booking_request','calendar_appointment_updated','calendar_meeting_request'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION active_calendar_meeting_request_notice(notice uuid, site uuid, recipient uuid) RETURNS boolean
LANGUAGE plpgsql STABLE AS $notice$
DECLARE eligible boolean;
BEGIN
  IF to_regclass('public.church_calendar_meeting_requests') IS NULL THEN RETURN false; END IF;
  EXECUTE $query$
    SELECT EXISTS (
      SELECT 1 FROM church_calendar_meeting_requests invitation
      JOIN church_calendar_appointments appointment ON appointment.id=invitation.appointment_id
      JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id AND calendar.department_id=appointment.department_id
      JOIN church_groups church_group ON church_group.id=calendar.group_id AND church_group.department_id=calendar.department_id AND church_group.status='active'
      JOIN department_memberships membership ON membership.department_id=calendar.department_id AND membership.user_id=invitation.recipient_user_id
      JOIN app_users account ON account.id=membership.user_id AND account.is_enabled AND NOT account.is_service_user
      JOIN contacts contact ON contact.id=membership.contact_id AND contact.department_id=membership.department_id AND contact.archived_at IS NULL
      JOIN group_members member ON member.group_id=calendar.group_id AND member.contact_id=contact.id AND member.status='active'
      WHERE invitation.notice_id=$1 AND calendar.department_id=$2 AND invitation.recipient_user_id=$3
        AND appointment.archived_at IS NULL AND calendar.archived_at IS NULL AND calendar.scope='group'
        AND invitation.scheduled_end>now()
    )
  $query$ INTO eligible USING notice, site, recipient;
  RETURN eligible;
END
$notice$;
