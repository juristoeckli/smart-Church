-- Retain the group identifier after archival or deletion so the restriction fails closed.
-- Community adds group lifecycle status after core migrations run.
CREATE OR REPLACE FUNCTION can_view_bookable_resource(location_id UUID, group_id UUID, viewer_id UUID, can_manage BOOLEAN)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
  SELECT COALESCE($4, false) OR $2 IS NULL OR EXISTS (
    SELECT 1
    FROM public.church_groups groups
    JOIN public.group_members member ON member.group_id=groups.id AND member.status='active'
    JOIN public.contacts contact ON contact.id=member.contact_id AND contact.department_id=groups.department_id AND contact.archived_at IS NULL
    JOIN public.department_memberships membership ON membership.contact_id=contact.id AND membership.department_id=contact.department_id
    WHERE groups.id=$2 AND groups.department_id=$1 AND (to_jsonb(groups)->>'status')='active' AND membership.user_id=$3
  )
$$;
