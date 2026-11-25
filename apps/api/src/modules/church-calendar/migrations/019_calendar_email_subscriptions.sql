CREATE TABLE IF NOT EXISTS church_calendar_email_subscriptions (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  calendar_id UUID NOT NULL REFERENCES church_calendar_calendars(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  cadence TEXT NOT NULL CHECK (cadence IN ('daily','weekly')),
  checked_through TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_check_at TIMESTAMPTZ NOT NULL,
  notice_id UUID UNIQUE,
  notice_since TIMESTAMPTZ,
  CHECK ((notice_id IS NULL) = (notice_since IS NULL)),
  CHECK (notice_since IS NULL OR notice_since < checked_through),
  FOREIGN KEY (user_id,department_id) REFERENCES department_memberships(user_id,department_id) ON DELETE CASCADE,
  PRIMARY KEY (calendar_id,user_id)
);

CREATE INDEX IF NOT EXISTS church_calendar_email_subscriptions_due_idx
  ON church_calendar_email_subscriptions (department_id,next_check_at,calendar_id,user_id);
CREATE INDEX IF NOT EXISTS church_calendar_appointments_new_idx
  ON church_calendar_appointments (calendar_id,created_at) WHERE archived_at IS NULL;

CREATE OR REPLACE FUNCTION church_calendar_can_receive_email(site_id UUID, selected_calendar UUID, recipient UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM church_calendar_calendars calendar
      JOIN departments site ON site.id=calendar.department_id
      JOIN department_memberships membership ON membership.department_id=site.id AND membership.user_id=recipient
      JOIN app_users account ON account.id=membership.user_id AND account.is_enabled AND NOT account.is_service_user
     WHERE calendar.id=selected_calendar AND calendar.department_id=site_id AND calendar.archived_at IS NULL
       AND site.enabled_modules @> ARRAY['church-calendar','notifications']::TEXT[]
       AND (calendar.scope='community' OR (calendar.scope='personal' AND calendar.owner_user_id=recipient)
            OR (calendar.scope='group' AND EXISTS (
        SELECT 1 FROM church_groups church_group
         WHERE church_group.id=calendar.group_id AND church_group.department_id=site_id AND COALESCE(to_jsonb(church_group)->>'status','active')='active'
           AND (membership.role='site_admin' OR membership.permissions && ARRAY['events_manage','groups_manage']
               OR COALESCE(membership.module_permissions->'church-calendar','[]'::jsonb) @> '["manage"]'::jsonb
               OR EXISTS (
                 SELECT 1 FROM group_members member JOIN contacts person ON person.id=member.contact_id
                   AND person.department_id=site_id AND person.archived_at IS NULL
                  WHERE member.group_id=church_group.id AND member.status='active' AND person.id=membership.contact_id
               ))
       )))
  )
$function$;
